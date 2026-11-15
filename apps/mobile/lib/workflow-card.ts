/**
 * The workflow card — the WHOLE pipeline an issue travels through, as a row
 * model (MYS-2889).
 *
 * ## Why this exists
 *
 * Iterations 288–291 taught the phone one column at a time: which statuses the
 * workflow allows, what a column hands off to, who receives it. What the phone
 * still could not show is the shape of the pipeline itself. Web renders
 * `IssueFlowCard` under the issue's Project row (`issue-detail.tsx:3167` →
 * `packages/views/workflows/issue-flow-card.tsx`): the workflow's name as a
 * trigger, and on click every column in order, with the actor that column hands
 * the issue to and the issue's current column highlighted. On a phone the only
 * way to learn "what comes after this, and who gets it" was to open the status
 * picker and infer the pipeline from an option list.
 *
 * `apps/mobile/CLAUDE.md` puts that in the must-agree column: the same question
 * ("where does this issue go next, and to whom") must not have two different
 * answers depending on the client.
 *
 * ## What this module decides, and what it does not
 *
 * Everything here is framework-free and unit-tested: which of four states the
 * card is in, the ordered row model, which single row is current, and each
 * row's handoff hint. Naming an actor (id → name) needs the workspace
 * directories, and drawing needs a renderer, so both live in
 * `components/issue/workflow-card.tsx` — the same split upstream makes between
 * `step-handler.ts` (pure) and `useStepHandlerLabel` (a hook).
 *
 * ## The four states, and why they must not collapse
 *
 * `issue-flow-card.tsx` answers `if (!workflow || !project) return null`. That
 * is correct on web, where the popover reads a settled cache. On a phone the
 * same expression would have the card VANISH whenever the workflow read failed
 * — and "this project runs no workflow" is a very different statement from "I
 * could not find out". The vanishing version is the defect this repository has
 * now fixed four times (`lib/workflow-status-scope.ts` iteration 251,
 * `data/queries/workflows.ts` iteration 254, `lib/actor-name-state.ts`
 * iteration 256, `lib/project-inline-edit.ts` iteration 253): an absent value
 * presented as a measured one. So the read's own state is a first-class input
 * and produces `pending` / `failed`, which the renderer shows as a mark and as
 * an error with a retry — never as absence.
 *
 * The same reasoning applies to the projects list. `resolveProjectWorkflow`
 * needs the project's `workflow_id`; until that list lands there is no project
 * row to read, so a named project with no project row is `pending`, NOT
 * "no workflow".
 *
 * ## Two rules that are easy to get wrong
 *
 * 1. **An issue outside any project shows no card.** Upstream's
 *    `IssueWorkflowPropRow` passes `projectId` into `useProjectWorkflow`, which
 *    answers null for a null id, so the row disappears. Falling back to the
 *    workspace Default here would print a pipeline that this issue does not
 *    travel: the server applies no project workflow outside a project
 *    (`issueworkflow.OutsideProject`). This is why the card deliberately does
 *    NOT use `issueStatusWorkflow` — that helper's job is the different
 *    question "which statuses may this issue take", and it answers Default
 *    outside a project on purpose (`lib/workflow.ts`).
 *
 * 2. **At most one row is current, and possibly none.** Web compares
 *    `step.status_key === currentStatus` per row. Two rows cannot normally
 *    share a key, but a workflow read from a stale cache could repeat one, and
 *    the highlight is the card's only visual claim about where the issue IS —
 *    so it is anchored to the FIRST matching row's index rather than evaluated
 *    per row. The "none" case is real and must stay reachable: a project can
 *    switch workflows and leave its issues on a status the new one does not
 *    list (`workflowStatusOptions` re-adds it to the picker for exactly that
 *    reason). Inventing a current column there would be a lie; the card then
 *    highlights nothing.
 */
import type { IssueWorkflow, Project } from "@multica/core/types";
import { handoffHint, type HandoffHint } from "@/lib/handoff-hint";
import type { WorkflowReadState } from "@/lib/workflow-status-scope";
import { resolveProjectWorkflow } from "@/lib/workflow";

/** One column of the pipeline, ready to draw. */
export interface WorkflowCardStep {
  /** The status this column stands for. Unique within a card. */
  statusKey: string;
  /** True for the issue's current column — at most one row, possibly none. */
  current: boolean;
  /**
   * What entering this column hands the issue to, or null when it hands off
   * nothing (or when the handler kind names nobody up front).
   *
   * Derived from `handoffHint`, i.e. from `stepHandsOff` — the same predicate
   * the handoff gate uses to decide whether to ask before writing. A card that
   * promised a handoff the gate would not perform is the one failure this
   * feature cannot have, so there is no second reading of `handler.type` here.
   */
  hint: HandoffHint | null;
}

export interface WorkflowCard {
  /** The workflow's own name, for the trigger and the sheet's title. */
  workflowName: string;
  /** The project's title, for the sheet's subtitle (`card_title`). */
  projectTitle: string;
  steps: WorkflowCardStep[];
}

/**
 * What the issue-detail surface should render.
 *
 * `hidden` is the ONLY absence, and it is reached only when that absence is
 * measured: no project at all, or a settled read that genuinely resolved no
 * workflow. `pending` and `failed` are gaps in knowledge and are drawn as
 * such.
 */
export type WorkflowCardState =
  | { kind: "hidden" }
  | { kind: "pending" }
  | { kind: "failed" }
  | { kind: "card"; card: WorkflowCard };

export interface WorkflowCardInput {
  /** `undefined` until the workflow read lands — never `[]` (see the query). */
  workflows: readonly IssueWorkflow[] | undefined;
  /** The read's own state; carries "still loading" vs "failed". */
  state: WorkflowReadState;
  /** The issue's project id. Null when the issue is in no project. */
  projectId: string | null | undefined;
  /**
   * The project row, once the projects list has answered. `undefined` while it
   * has not; that is a gap, not an absence.
   */
  project: Pick<Project, "id" | "title" | "lead_type" | "lead_id" | "workflow_id"> | undefined;
  /** The issue's current status, for the highlight. */
  currentStatus: string | null | undefined;
}

/** Just enough of a project to build the card — the `lead_*` fields feed a
 *  `project_lead` handler's `stepHandlerActor`. */
export type WorkflowCardProject = Pick<
  Project,
  "id" | "title" | "lead_type" | "lead_id" | "workflow_id"
>;

/**
 * The card for one issue, in one of four states.
 *
 * The order of the guards is the decision, so it is spelled out rather than
 * folded into a chain of `&&`:
 *
 *   1. no project id → `hidden`. Upstream's `if (!workflow) return null`, and
 *      the reason the Default must NOT stand in — see rule 1 in the module doc.
 *   2. the read failed → `failed`. Checked BEFORE the pending/absent cases so a
 *      failure can never be mistaken for either.
 *   3. the read has not settled → `pending`.
 *   4. the project row has not arrived → `pending`: `resolveProjectWorkflow`
 *      cannot see a `workflow_id` that has not been read.
 *   5. a settled read resolved no workflow → `hidden`. This is now a fact: this
 *      workspace has no workflows (an older server), or the project names one
 *      that no longer exists AND there is no Default to stand in.
 *   6. otherwise the card.
 */
export function workflowCardState(input: WorkflowCardInput): WorkflowCardState {
  const { workflows, state, projectId, project, currentStatus } = input;

  if (!projectId) return { kind: "hidden" };
  if (state === "failed") return { kind: "failed" };
  if (state !== "ready") return { kind: "pending" };
  if (!project || project.id !== projectId) return { kind: "pending" };

  const workflow = resolveProjectWorkflow(workflows, project);
  if (!workflow) return { kind: "hidden" };

  return { kind: "card", card: buildWorkflowCard(workflow, project, currentStatus) };
}

/**
 * The rows of the card, in pipeline order.
 *
 * The current column is found ONCE, by index, and each row asks "am I that
 * index". Evaluating `status_key === currentStatus` per row would highlight
 * every duplicate of a repeated key and, worse, would silently start
 * depending on the read never repeating one — a guarantee this layer cannot
 * enforce. `findIndex` gives the first match and nothing else.
 *
 * `currentStatus` that the workflow does not list yields -1, so no row is
 * current. That is a real state (the project switched workflows; see the
 * module doc) and the card must be able to say "nowhere on this pipeline"
 * rather than pick a column.
 */
export function buildWorkflowCard(
  workflow: IssueWorkflow,
  project: WorkflowCardProject | null | undefined,
  currentStatus: string | null | undefined,
): WorkflowCard {
  const currentIndex =
    currentStatus == null
      ? -1
      : workflow.steps.findIndex((step) => step.status_key === currentStatus);

  return {
    workflowName: workflow.name,
    projectTitle: project?.title ?? "",
    steps: workflow.steps.map((step, index) => ({
      statusKey: step.status_key,
      current: index === currentIndex,
      // The SAME call the status picker's hint makes, with the same project —
      // one predicate, one vocabulary, two surfaces.
      hint: handoffHint(step, project),
    })),
  };
}

/** How many rows the card marks as current. Never more than one; see above. */
export function currentStepCount(card: WorkflowCard): number {
  return card.steps.filter((step) => step.current).length;
}

/** The row marked current, when there is one. */
export function currentStep(card: WorkflowCard): WorkflowCardStep | undefined {
  return card.steps.find((step) => step.current);
}
