/**
 * Pure rules for the run-confirm face (web `packages/views/modals/run-confirm.tsx`,
 * MUL-3375 / MUL-5010).
 *
 * Assigning an issue to an agent or a squad is the one issue write that can
 * start an agent run, and it is the one write the web client refuses to apply
 * directly: it asks first, and the dialog it asks with carries two control
 * fields (`suppress_run`, `handoff_note`). Mobile shipped that face for the
 * BATCH toolbar only (iteration 66), so the same irreversible action on the
 * issue detail page applied straight through with no chance to attach a note —
 * one action, two semantics, on the same phone.
 *
 * This module holds the parts of that face that are decisions rather than
 * markup, so both surfaces share one answer and the Node vitest lane can pin
 * them (see `vitest.config.ts` — there is no RN renderer there).
 */
import type {
  Issue,
  IssueAssigneeType,
  IssueStatus,
  UpdateIssueRequest,
} from "@multica/core/types";
import { needRunConfirm } from "@/lib/batch-issues";

/** Web caps the handoff note at 2000 characters
 *  (`packages/views/modals/run-confirm.tsx:26`). The server takes the field as
 *  free text, so the cap is the client's contract, not the API's — enforced on
 *  the write path here rather than only in one dialog's text input. */
export const MAX_HANDOFF_NOTE = 2000;

/** The actor an assignment is being routed to. */
export interface AssignTarget {
  type: "agent" | "squad";
  id: string;
}

/**
 * Whether assigning `assigneeType` to this single issue must be confirmed
 * first.
 *
 * Deliberately a one-element call into `needRunConfirm` rather than a second
 * reading of the same rule: the batch toolbar short-circuits an all-backlog
 * selection (a parking-lot assignment can never start a run), and "all of one
 * issue is in backlog" has to mean exactly what "all of the selection is in
 * backlog" means. A second literal here is how the two surfaces drifted apart
 * to begin with. Members and clearing the assignee fall out of the same
 * predicate — they can never start a run.
 *
 * An UNKNOWN issue confirms. The picker reads its status from the issue detail
 * cache, which a sub-issue edited from its parent's row list has never
 * populated — so "no issue" is a real state at this call site, not a defensive
 * branch. The two directions are not symmetric: asking when the answer was
 * "backlog" costs one tap on a dialog that can be dismissed, while not asking
 * when a run was about to start is an irreversible side effect the user never
 * agreed to. This is the same fail-closed reading the picker's own value
 * derivation uses.
 */
export function singleAssignNeedsRunConfirm(
  issue: Pick<Issue, "status"> | null | undefined,
  assigneeType: IssueAssigneeType | null | undefined,
): boolean {
  if (assigneeType !== "agent" && assigneeType !== "squad") return false;
  if (!issue) return true;
  return needRunConfirm([issue], assigneeType);
}
/**
 * The PATCH body for a confirmed assignment.
 *
 * The two control fields are mutually exclusive, and that is load-bearing, not
 * cosmetic (web `submit()`, `run-confirm.tsx`): "Don't start yet" means the
 * write must not start a run, so it sends `suppress_run` and NO note; the
 * confirm path sends the note and no `suppress_run`. Sending both would hand
 * the server a note for a run it was told not to start.
 *
 * A blank note is omitted rather than sent as `""` — the server renders the
 * field into the run's opening prompt, and an empty string would add an empty
 * handoff section to it.
 */
export function assignConfirmPayload(
  target: AssignTarget,
  suppressRun: boolean,
  note: string,
): UpdateIssueRequest {
  const trimmed = note.trim().slice(0, MAX_HANDOFF_NOTE);
  return {
    assignee_type: target.type,
    assignee_id: target.id,
    ...(suppressRun ? { suppress_run: true } : {}),
    ...(!suppressRun && trimmed ? { handoff_note: trimmed } : {}),
  };
}

/** What the new-issue form's passive pre-trigger caption should say. */
export type CreateRunHintKind = "hidden" | "willStart" | "parked";

/**
 * The create form's pre-trigger caption (web `CreateRunHint`,
 * `packages/views/modals/create-issue.tsx:112-140`).
 *
 * `"hidden"` covers both "no agent-like assignee picked" and "the predicate has
 * not answered yet". The second is the reason this is a three-way state rather
 * than a boolean: revealing a "won't start" caption and then flipping it to
 * "will start" once the request lands is worse than showing nothing, and it is
 * the exact flash web's reveal band exists to avoid.
 *
 * There is deliberately no `status` input. The verdict is the server's, asked
 * with the status as one of its inputs; re-deriving "backlog → parked" here
 * would be a second implementation of the very predicate this caption exists to
 * stop guessing at — and the status is already folded into `willStart`.
 */
export function createRunHintKind(params: {
  assigneeType: IssueAssigneeType | null | undefined;
  assigneeId: string | null | undefined;
  /** The preview request is still in flight (first load only). */
  isLoading: boolean;
  /** `total_count` from the preview, once resolved. */
  willStart: boolean;
}): CreateRunHintKind {
  const isAgentLike =
    params.assigneeType === "agent" || params.assigneeType === "squad";
  if (!isAgentLike || !params.assigneeId || params.isLoading) return "hidden";
  return params.willStart ? "willStart" : "parked";
}

/** Which i18n key the caption's line resolves to for a given kind. A squad
 *  does not work an issue itself — its leader evaluates and delegates — so the
 *  squad path gets its own sentence. Returns null when there is nothing to
 *  show, which keeps the caller from resolving a key it will not render. */
export function createRunHintKey(
  kind: CreateRunHintKind,
  assigneeType: IssueAssigneeType | null | undefined,
): string | null {
  if (kind === "hidden") return null;
  if (kind === "parked") return "runConfirm.createParked";
  return assigneeType === "squad"
    ? "runConfirm.createWillStartSquad"
    : "runConfirm.createWillStart";
}
