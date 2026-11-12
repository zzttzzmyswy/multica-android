/**
 * Should this move ask before it writes? — the pure predicate behind every
 * status-write and project-move surface (MUL-7420, MYS-2743).
 *
 * ## Why this is separate from `lib/workflow-handoff.ts`
 *
 * That module transcribes the DIALOG's decisions once the server has answered.
 * This one decides whether to ask the server at all, using only what is already
 * cached. Two different questions with two different failure modes, and keeping
 * them apart is what lets the cheap one stay synchronous.
 *
 * ## The three answers, and why "unknown" is its own
 *
 *   - `apply` — no handoff is possible under this move, so write immediately.
 *     Reaching the network here would put a round-trip in front of every
 *     ordinary status change in every workspace, for an answer that is already
 *     known: the destination column has no handler (`stepHandsOff` false).
 *   - `confirm` — a handoff is possible; read the preview and show the dialog.
 *   - `refuse` — the workflow read has not answered, so even the cheap question
 *     cannot be settled. Writing anyway would be exactly the silent reassign
 *     this iteration removes, and it is the *common* case at cold start, so it
 *     is not a corner.
 *
 * ## `refuse` is not "do nothing"
 *
 * This outcome is easy to misread as "abandon the move", and the first version
 * of the gate did: it returned without holding the write, so the surface's
 * action sheet simply vanished. That is both unexplained and — worse — left
 * whatever the caller had already committed (the board's settle lock) with no
 * owner, freezing the board's lane order until the screen was re-entered.
 *
 * So `refuse` means "the cheap predicate cannot answer; ask the server
 * instead": the caller holds the write and opens the preview, which is the one
 * authority that can still speak to this specific move. If the preview says the
 * move hands off, the user confirms it; if it says it does not, the write is
 * applied without a prompt. Either way the move is decided by a real answer
 * rather than by a guess, and the caller's hold always has a release path.
 *
 * ## Why `apply` may only come from a POSITIVE answer
 *
 * `stepHandsOff` answers "this column reassigns". A workflow whose destination
 * column keeps the assignee is a definite "no handoff". But an UNKNOWN workflow
 * is not — and treating it as one is the failure mode this repo has shipped
 * three times (iterations 251, 254, 256: folding "could not read" into "there
 * is nothing"). So `workflowState !== "ready"` short-circuits to `refuse`, and
 * the only path to `apply` is a loaded workflow that says so.
 *
 * The same rule covers the PROJECT LIST, which is what iteration 290's first
 * cut got wrong: the status branch resolved the issue's workflow through the
 * project list and mapped "project not in the list yet" to `apply`, while the
 * project-move branch mapped the identical state to `refuse`. Both are now
 * `refuse`, and `apply` on a project issue requires the list to have answered.
 */
import type { IssueWorkflow, Project } from "@multica/core/types";
import {
  projectMoveMayHandOff,
  resolveProjectWorkflow,
  stepHandsOff,
  workflowStep,
} from "@/lib/workflow";
import type { WorkflowReadState } from "@/lib/workflow-status-scope";
import type { HandoffTarget } from "@/components/issue/workflow-handoff-dialog";

export type HandoffGateOutcome = "apply" | "confirm" | "refuse";

export interface HandoffGateInput {
  /** The issue's move-relevant fields; null while the issue itself is unknown. */
  issue: { status: string; project_id: string | null } | null;
  target: HandoffTarget;
  workflows: readonly IssueWorkflow[] | undefined;
  workflowState: WorkflowReadState;
  projects: readonly Project[] | undefined;
}

/**
 * Whether the move must be confirmed first.
 *
 * A STATUS change only asks when the destination step hands off. A move INTO
 * another project asks when the move enters a column that hands off — which
 * depends on whether the destination workflow lists the issue's current status
 * (`projectMoveMayHandOff`, the transcription of upstream's predicate).
 */
export function qualifiesForHandoffGate(input: HandoffGateInput): HandoffGateOutcome {
  const { issue, target, workflows, workflowState, projects } = input;
  if (!issue) return "refuse";
  // A loaded workflow is the precondition for a POSITIVE "no handoff" — see the
  // file header. `failed` and `pending` both land here.
  if (workflowState !== "ready" || !workflows) return "refuse";

  if (target.kind === "status") {
    // Same column: nothing moves, so nothing can hand off.
    if (target.status === issue.status) return "apply";
    // An issue IN a project needs that project to be resolvable before any
    // non-move answer is allowed. The project list is a SEPARATE read from the
    // workflow list and has no staleTime, while `useIssueWorkflows` holds for
    // five minutes — so "workflows ready, projects in flight" is the ordinary
    // state of a page's first frames, not a corner. Reading that state as
    // "no workflow → apply" silently reassigned on exactly the projects this
    // iteration exists to protect. See the header's POSITIVE-answer rule.
    if (issue.project_id && !projects) return "refuse";
    const workflow = issueStatusWorkflowFor(workflows, projects, issue);
    // A project id the LOADED list does not know: the server would reject this
    // status (`status_not_in_workflow`) and the client cannot say whether the
    // column hands off. Not a positive answer, so it does not apply.
    if (!workflow) return "refuse";
    return stepHandsOff(workflowStep(workflow, target.status)) ? "confirm" : "apply";
  }

  // A project move into the project the issue is already in changes nothing.
  // The caller decides whether to send it at all; if it does, the project's own
  // workflow still has the final word, so the check runs unchanged.
  const destination = projects?.find((p) => p.id === target.projectId);
  if (!destination) {
    // An unknown project id means the project list has not answered. That is
    // the same "cannot tell" as an unread workflow, so it refuses rather than
    // guessing that the destination is administrative.
    return "refuse";
  }
  const workflow = resolveProjectWorkflow(workflows, destination);
  return projectMoveMayHandOff(workflow, issue.status) ? "confirm" : "apply";
}

/**
 * The workflow whose STATUSES this issue may take: its project's, or Default
 * for an issue outside any project.
 *
 * Deliberately separate from `resolveProjectWorkflow`: that one takes a project
 * and returns Default for a null one (correct for HANDOFFS, which need the
 * project's own workflow), while a status change on a project-less issue is
 * limited by Default. Mirrors `issueStatusWorkflow` in `lib/workflow.ts`.
 */
function issueStatusWorkflowFor(
  workflows: readonly IssueWorkflow[],
  projects: readonly Project[] | undefined,
  issue: { project_id: string | null },
): IssueWorkflow | null {
  if (!issue.project_id) {
    return workflows.find((w) => w.is_default) ?? null;
  }
  const project = projects?.find((p) => p.id === issue.project_id);
  if (!project) return null;
  return resolveProjectWorkflow(workflows, project);
}
