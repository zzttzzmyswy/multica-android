/**
 * Project workflows — the status-validity half of web's
 * `packages/core/issue-workflows/queries.ts` (MUL-7420, MUL-8250).
 *
 * ## Why this exists at all
 *
 * A project may name a workflow; a workflow is an ordered pick from the shared
 * status catalog. The **server enforces it**: `applyIssueWorkflow`
 * (`server/internal/handler/issue_workflow_entry.go`) rejects any status write
 * for a status the issue's workflow does not list, answering `400` with
 * `code: "status_not_in_workflow"` and the allowed keys. A project that names
 * no workflow uses the workspace Default, which also limits: Default is a real
 * workflow row listing a subset of the catalog.
 *
 * Mobile had none of this. Every status surface — the picker, the board card
 * sheet, the swimlane header — read `useStatusOptions`, which is the whole
 * active catalog regardless of the issue's project. So the phone offered
 * statuses the server would refuse, on every issue in a workspace that had
 * narrowed any workflow.
 *
 * ## What is mirrored, and what is not
 *
 * Only the **pure** predicates. The web hooks (`useIssueWorkflows`,
 * `useProjectWithWorkflow`, `useIssueStatusOptions`) are React + query-client
 * code against `@multica/core`'s api singleton, which mobile does not use; the
 * mobile equivalents live in `data/queries/workflows.ts` and
 * `lib/status-options.ts`.
 *
 * Every function below is a line-for-line transcription of its upstream
 * counterpart, and `lib/workflow.test.ts` carries the upstream file's own
 * cases verbatim. That is deliberate: this is the kind of mirror that silently
 * drifts, and a divergence here means the phone offers a status the desktop
 * refuses — the exact defect the module removes.
 *
 * ## The one rule that is easy to get wrong
 *
 * "Workflows are unknown" and "there is no workflow" are different answers,
 * and the code must not conflate them. A failed or in-flight read returns
 * `null` from these helpers, and `workflowAllowsStatus(null, …)` allows
 * everything — web's choice, correct while loading, because refusing every
 * status during a fetch would be worse. But that also means a *failed* read
 * silently degrades to "offer everything", which is the same lie the picker
 * told before. The query layer therefore has to keep failure distinguishable
 * from absence; see `data/queries/workflows.ts`.
 */
import type {
  Project,
  IssueWorkflow,
  IssueWorkflowStep,
} from "@multica/core/types";

/** The statuses with fixed places at the ends of a workflow, in order. */
export const WORKFLOW_HEAD_STATUSES = ["backlog", "todo"] as const;
export const WORKFLOW_TAIL_STATUSES = ["blocked", "done", "cancelled"] as const;
/** Fixed statuses a workflow may leave out; the others every workflow lists. */
export const WORKFLOW_OPTIONAL_STATUSES = ["backlog", "blocked"] as const;

const FIXED_STATUSES = new Set<string>([
  ...WORKFLOW_HEAD_STATUSES,
  ...WORKFLOW_TAIL_STATUSES,
]);

/** Columns that can never hand off: parking and closing columns. */
const NO_HANDOFF_STATUSES = new Set(["backlog", "done", "cancelled"]);

/** The workspace Default workflow, once workflows are loaded. */
export function defaultWorkflow(
  workflows: readonly IssueWorkflow[] | undefined,
): IssueWorkflow | null {
  return workflows?.find((w) => w.is_default) ?? null;
}

/**
 * The workflow a project uses — its named one, else Default; null while
 * workflows are unknown.
 *
 * A dangling `workflow_id` (the workflow was deleted, or the read is a stale
 * cache) renders as Default rather than nothing, which is also how the server
 * treats the reference.
 */
export function resolveProjectWorkflow(
  workflows: readonly IssueWorkflow[] | undefined,
  project: Pick<Project, "workflow_id"> | null | undefined,
): IssueWorkflow | null {
  if (!project || !workflows) return null;
  const named = project.workflow_id
    ? workflows.find((w) => w.id === project.workflow_id)
    : undefined;
  return named ?? defaultWorkflow(workflows);
}

/**
 * The workflow whose statuses an issue may take: its project's, or Default for
 * an issue outside any project.
 *
 * Deliberately statuses only. Outside a project nothing hands off, so handoffs
 * still come from `resolveProjectWorkflow`. Null while workflows or the issue's
 * project are unknown.
 */
export function issueStatusWorkflow(
  workflows: readonly IssueWorkflow[] | undefined,
  projects: readonly Pick<Project, "id" | "workflow_id">[] | undefined,
  issue: { project_id: string | null },
): IssueWorkflow | null {
  if (!issue.project_id) return defaultWorkflow(workflows);
  return resolveProjectWorkflow(
    workflows,
    projects?.find((p) => p.id === issue.project_id),
  );
}

/**
 * The statuses every one of `issues` may take, or null when none is limited.
 * A batch status change offers this set, so it never shows a status the
 * server would skip.
 */
export function sharedWorkflowStatusKeys(
  workflows: readonly IssueWorkflow[] | undefined,
  projects: readonly Pick<Project, "id" | "workflow_id">[] | undefined,
  issues: readonly { project_id: string | null }[],
): Set<string> | null {
  let shared: Set<string> | null = null;
  for (const issue of issues) {
    const workflow = issueStatusWorkflow(workflows, projects, issue);
    if (!workflow) continue;
    const keys = new Set<string>(workflow.steps.map((s) => s.status_key));
    const current: Set<string> | null = shared;
    if (!current) {
      shared = keys;
      continue;
    }
    // Intersect by iteration rather than spread/filter: this package's tsconfig
    // has neither `downlevelIteration` nor an ES2015+ iterable lib, so
    // `[...set]` and `Array.from(set)` both erase to `never[]`/`unknown[]` and
    // stop type-checking.
    const next = new Set<string>();
    current.forEach((key) => {
      if (keys.has(key)) next.add(key);
    });
    shared = next;
  }
  return shared;
}

export function workflowStep(
  workflow: IssueWorkflow | null | undefined,
  statusKey: string,
): IssueWorkflowStep | undefined {
  return workflow?.steps.find((s) => s.status_key === statusKey);
}

/** Whether entering the step reassigns the issue. */
export function stepHandsOff(step: IssueWorkflowStep | undefined): boolean {
  return !!step && step.handler.type !== "none";
}

/**
 * Whether issues on `workflow` may enter a status.
 *
 * An issue already on a status its workflow no longer lists keeps it, so
 * callers exempt the issue's current status. Null — workflows still loading or
 * unknown — allows every status.
 */
export function workflowAllowsStatus(
  workflow: IssueWorkflow | null | undefined,
  statusKey: string,
): boolean {
  if (!workflow) return true;
  return workflow.steps.some((s) => s.status_key === statusKey);
}

/**
 * The column a step's handler is told to move to when done: the step's own
 * choice, else the next column (skipping blocked); empty at the end.
 */
export function workflowNextStatus(
  workflow: Pick<IssueWorkflow, "steps">,
  statusKey: string,
): string {
  const index = workflow.steps.findIndex((s) => s.status_key === statusKey);
  if (index < 0) return "";
  const own = workflow.steps[index]?.next_status_key;
  if (own) return own;
  for (const s of workflow.steps.slice(index + 1)) {
    if (s.status_key !== "blocked") return s.status_key;
  }
  return "";
}

/** The columns between the fixed head and tail, in order. */
export function workflowMiddleKeys(
  workflow: Pick<IssueWorkflow, "steps">,
): string[] {
  return workflow.steps
    .map((s) => s.status_key)
    .filter((k) => !FIXED_STATUSES.has(k));
}

/** Whether a status has a fixed place when a workflow lists it. */
export function isFixedWorkflowStatus(statusKey: string): boolean {
  return FIXED_STATUSES.has(statusKey);
}

/** Whether a column can have a handler: parking and closing columns cannot. */
export function statusAcceptsHandoff(statusKey: string): boolean {
  return !NO_HANDOFF_STATUSES.has(statusKey);
}

/**
 * Whether moving an issue on `statusKey` into a project using `workflow` may
 * hand it off, when the move enters the column it lands on: the column it
 * keeps hands off, or it lands on another column and some column does. The
 * server preview has the final word.
 */
export function projectMoveMayHandOff(
  workflow: IssueWorkflow | null | undefined,
  statusKey: string,
): boolean {
  if (!workflow) return false;
  // A move into a Default project keeps the issue's status, listed or not.
  if (workflow.is_default || workflowAllowsStatus(workflow, statusKey)) {
    return stepHandsOff(workflowStep(workflow, statusKey));
  }
  return workflow.steps.some(stepHandsOff);
}

/** Steps whose entry reassigns the issue. */
export function handoffStepCount(workflow: IssueWorkflow): number {
  return workflow.steps.filter((s) => stepHandsOff(s)).length;
}
