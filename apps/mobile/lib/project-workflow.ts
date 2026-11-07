/**
 * Project workflow binding — the pure half of web's
 * `packages/views/workflows/project-workflow-row.tsx` +
 * `workflows/permissions.ts` (MUL-7420, MYS-2690).
 *
 * ## What was missing
 *
 * Iteration 288 taught the phone's *status writes* about project workflows: the
 * picker offers only the columns a project's workflow lists. That left the
 * project side untouched — a phone user could not see which workflow a project
 * runs, and could not change it, while a web user could do both. The property
 * row and the switch flow below are the mobile rendering of the same facts.
 *
 * ## Three rules this module encodes, each one a defect if dropped
 *
 * 1. **`workflow_id: null` means "switch to Default", not "leave it alone".**
 *    Upstream's picker flips the selection with `workflow.is_default ? null :
 *    workflow.id` (`project-workflow-row.tsx:60`). Treating `null` as "no
 *    change" makes the "back to Default" action impossible to send at all.
 *    {@link projectWorkflowIdFor} is that single transformation.
 *
 * 2. **A switch must be previewed before it is sent.** The server answers
 *    `409 workflow_status_mapping_required` with a plan naming every status the
 *    target workflow lacks, and the write is refused until each one is mapped.
 *    Skipping the dry run means the user hits that refusal with no idea which
 *    statuses are involved. {@link mappingNeedsChoice} and
 *    {@link defaultStatusMapping} are the local half of the dry-run contract.
 *
 * 3. **Management is not `role` alone.** `canManageProjectWorkflow` mirrors the
 *    server's `canManageProjectWorkflow`
 *    (`server/internal/handler/issue_workflow.go:51`): a workspace admin, OR the
 *    project's lead when that lead is a *member* (an agent lead cannot sign in
 *    and therefore cannot manage anything). Judging on the role alone locks the
 *    project lead out; judging on the lead alone locks admins out of projects
 *    they do not lead.
 *
 * Pure: no React, no i18n, no `@/data/api` — the Node vitest lane exercises it
 * directly, the same split every other `lib/` module in this app uses.
 */
import type { IssueWorkflow, IssueWorkflowMappingPlan, Project } from "@multica/core/types";

/** Roles that make a member a workspace admin (owner counts, as the server's
 *  `isWorkspaceAdmin` does — `roleAllowed(member.Role, "owner", "admin")`). */
const ADMIN_ROLES = new Set<string>(["owner", "admin"]);

/**
 * The project fields the management rule reads. A narrowed `Pick`, not the
 * whole `Project`, so a caller holding a list projection can still ask.
 */
export type WorkflowManagedProject = Pick<Project, "lead_type" | "lead_id">;

/**
 * Whether this member may change the project's workflow binding.
 *
 * Mirrors `canManageProjectWorkflow` on the server exactly:
 * `isAdmin || (lead_type === "member" && lead_id === me)`.
 *
 * The `lead_type === "member"` test is load-bearing rather than defensive: a
 * project led by an *agent* has a `lead_id` that is an agent id, and the server
 * compares it against the caller's USER id. Dropping the type check would let a
 * member whose user id happened to equal some agent's id pass — and, more
 * practically, would make the rule read as "the lead, whoever that is", which
 * is the wrong rule to transcribe.
 */
export function canManageProjectWorkflow({
  project,
  currentUserId,
  currentRole,
}: {
  project: WorkflowManagedProject | null | undefined;
  currentUserId: string | null | undefined;
  currentRole: string | null | undefined;
}): boolean {
  if (currentRole && ADMIN_ROLES.has(currentRole)) return true;
  if (!project || !currentUserId) return false;
  return project.lead_type === "member" && project.lead_id === currentUserId;
}

/**
 * The `workflow_id` to PUT for a chosen workflow: `null` for the workspace
 * Default, its own id otherwise.
 *
 * This is upstream's `workflow.is_default ? null : workflow.id`
 * (`project-workflow-row.tsx:60`) written once. The server treats an empty id
 * and the Default row's own id as the same answer (`issue_workflow.go:982`),
 * so sending `null` is the canonical form and what the dry run expects.
 */
export function projectWorkflowIdFor(
  workflow: Pick<IssueWorkflow, "id" | "is_default">,
): string | null {
  return workflow.is_default ? null : workflow.id;
}

/**
 * Whether a choice would change anything — i.e. whether the preview and the
 * confirm dialog are worth opening at all.
 *
 * Upstream short-circuits on exactly this (`project-workflow-row.tsx:57`):
 * `if (workflowId === (project.workflow_id ?? null)) return`. Without it,
 * re-picking the current workflow runs a dry run, shows a mapping dialog that
 * moves nothing, and writes the same value back.
 *
 * `project.workflow_id` is `undefined` on servers that predate the field; that
 * means "Default", same as `null`, so it is coalesced rather than compared
 * raw — otherwise picking Default on such a server would look like a change
 * every time.
 */
export function projectWorkflowChoiceChanges({
  project,
  workflow,
}: {
  project: Pick<Project, "workflow_id"> | null | undefined;
  workflow: Pick<IssueWorkflow, "id" | "is_default">;
}): boolean {
  return projectWorkflowIdFor(workflow) !== (project?.workflow_id ?? null);
}

/**
 * The statuses a switch forces the user to map: every status the target
 * workflow does not list, in the server's order.
 *
 * Kept as the plan's own `required` rows rather than a bare key list, because
 * each row also carries the issue count the dialog prints and the suggested
 * destination.
 */
export function mappingRequirements(
  plan: IssueWorkflowMappingPlan | null | undefined,
): IssueWorkflowMappingPlan["required"] {
  return plan?.required ?? [];
}

/** Whether the dry run says the switch needs the user to pick destinations. */
export function mappingNeedsChoice(
  plan: IssueWorkflowMappingPlan | null | undefined,
): boolean {
  return mappingRequirements(plan).length > 0;
}

/** Total issues the switch would move — the number the confirm button names. */
export function mappingAffectedIssues(
  plan: IssueWorkflowMappingPlan | null | undefined,
): number {
  if (!plan) return 0;
  // `affected_issues` is the server's own sum over `required`; fall back to
  // adding them up when a drifted body omits it (it defaults to 0 in a parse,
  // which would otherwise print "Switch and update 0 issues" while moving
  // some).
  if (plan.affected_issues > 0) return plan.affected_issues;
  return mappingRequirements(plan).reduce((sum, row) => sum + row.issue_count, 0);
}

/** Total issues that keep their status — the "nothing moves for these" line. */
export function mappingUnchangedIssues(
  plan: IssueWorkflowMappingPlan | null | undefined,
): number {
  if (!plan) return 0;
  return (plan.unchanged ?? []).reduce((sum, row) => sum + row.issue_count, 0);
}

/**
 * The mapping the dialog pre-fills: every required status pointed at its
 * suggestion when the target workflow has it, else at the target's first
 * status.
 *
 * Mirrors upstream's `useEffect` (`workflow-mapping-dialog.tsx:48-58`). The
 * fallback matters for a drifted body whose `suggested_status_key` names a
 * status the target no longer lists — an unset destination would make the
 * confirm button dead with no way to learn why, because the row's picker would
 * render blank and the completeness test would fail silently.
 *
 * @param targetKeys the target workflow's statuses, in its own order
 */
export function defaultStatusMapping(
  plan: IssueWorkflowMappingPlan | null | undefined,
  targetKeys: readonly string[],
): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const row of mappingRequirements(plan)) {
    mapping[row.status_key] = targetKeys.includes(row.suggested_status_key)
      ? row.suggested_status_key
      : (targetKeys[0] ?? "");
  }
  return mapping;
}

/**
 * Whether every required status has a destination — the confirm button's
 * enabled state.
 *
 * A blank destination is not merely incomplete UI: the server's `checkMapping`
 * refuses the whole write with `choose a destination status for the N issue(s)
 * on "x"`, and the user would have to work out which row was empty from a
 * sentence that lists a raw status key.
 */
export function statusMappingComplete(
  plan: IssueWorkflowMappingPlan | null | undefined,
  mapping: Record<string, string>,
): boolean {
  return mappingRequirements(plan).every((row) => !!mapping[row.status_key]);
}

/**
 * The `status_mapping` to send with the write, or `undefined` when nothing
 * needs moving.
 *
 * Upstream sends the mapping only when the plan required one
 * (`project-workflow-row.tsx:76`): `status_mapping: pending.plan.required.length
 * > 0 ? mapping : undefined`. Sending a stale mapping for a plan with no
 * required rows is harmless on the server but hides the real question from the
 * next reader of this code, so the shape is pinned here.
 */
export function statusMappingPayload(
  plan: IssueWorkflowMappingPlan | null | undefined,
  mapping: Record<string, string>,
): Record<string, string> | undefined {
  if (!mappingNeedsChoice(plan)) return undefined;
  const required = mappingRequirements(plan);
  const payload: Record<string, string> = {};
  for (const row of required) {
    const target = mapping[row.status_key];
    if (target) payload[row.status_key] = target;
  }
  return payload;
}

/**
 * The projects using one workflow, for the picker's "Used by: …" line.
 *
 * Two different facts have to agree here, and they live in different places:
 * the workflow's own `project_ids` (which the server groups by workflow,
 * counting a dangling or absent `workflow_id` as Default —
 * `projectIDsByWorkflow`, `issue_workflow.go:151`) and the cached project list,
 * which is what carries titles. Upstream filters the LIST by membership rather
 * than reading `project_ids` alone (`project-workflow-row.tsx:104`), because a
 * project deleted elsewhere lingers in the workflow row until its next refetch
 * and would otherwise be named.
 *
 * Default is the one case where membership cannot be read off `project_ids`:
 * it collects every project that names no workflow, so the predicate is
 * `!p.workflow_id` rather than an id match — upstream's exact split
 * (`project-workflow-row.tsx:104`).
 */
export function workflowsProjectNames({
  workflow,
  projects,
}: {
  workflow: Pick<IssueWorkflow, "id" | "is_default" | "project_ids">;
  projects: readonly Pick<Project, "id" | "title" | "workflow_id">[] | undefined;
}): string[] {
  if (!projects) return [];
  return projects
    .filter((p) =>
      workflow.is_default
        ? !p.workflow_id
        : workflow.project_ids.includes(p.id),
    )
    .map((p) => p.title);
}
