/**
 * The handoff confirmation's pure decisions — web
 * `packages/views/workflows/handoff-confirm-dialog.tsx` (MUL-7420) as
 * predicates, so the phone asks the same questions the desktop asks.
 *
 * ## The gap this closes
 *
 * Iterations 288/289 taught mobile to *know* about workflows: which statuses a
 * project allows, and which workflow a project uses. Neither touched what
 * happens when a status change **hands the issue off**. On the desktop, moving
 * an issue into a handoff column first asks "from whom to whom, is the previous
 * agent still running, stop it?, and here is what the new handler is told". On
 * the phone it reassigned silently — so a user could hand a running task to
 * another agent without being told, while the first agent kept burning tokens
 * on the same issue. That is a product-semantics divergence, which
 * `apps/mobile/CLAUDE.md` forbids ("State enums / transitions", "Permissions").
 *
 * ## Why the decisions are here and not in the component
 *
 * Every rule below is a line-for-line transcription of something the upstream
 * component does inline. Kept inline, each would be untestable without a
 * renderer, and this is precisely the kind of mirror that drifts in silence —
 * the same reason `lib/workflow.ts` exists next to `workflow-status-scope.ts`.
 *
 * ## The rule that is easiest to get wrong
 *
 * **"The read failed" and "there is no handoff" are different answers.** The
 * whole point of the dialog is that a silent reassign is a defect; treating an
 * unreadable preview as "no handoff" restores that defect while looking like it
 * works. `handoffGateKind` gives failure its own state (`error`) and the dialog
 * then refuses to confirm rather than guessing. This repo has shipped that
 * exact bug three times already (iterations 251, 254, 256), which is why the
 * distinction lives in a named predicate with a mutation-tested case rather
 * than in a `?? {handoff: false}` at the call site.
 */

/** A run of the agent the handoff takes the issue from. */
export interface HandoffPreviewRun {
  task_id: string;
  agent_id: string;
  status: string;
  started_at: string | null;
}

/**
 * The preview body — a structural subset of core's `WorkflowHandoffPreview`,
 * so this module stays free of the type package and the Node test lane can
 * drive it. Field-for-field the same shape; `data/schemas.ts` parses into it.
 */
export interface HandoffPreviewLike {
  handoff: boolean;
  workflow_name: string;
  from_status: string;
  to_status: string;
  handler_type: "agent" | "squad" | "member" | null;
  handler_id: string | null;
  previous_assignee_type: string | null;
  previous_assignee_id: string | null;
  previous_runs: HandoffPreviewRun[];
  brief: string;
}

/**
 * What the server answers when it has nothing to hand off. Mirrors upstream's
 * `EMPTY_WORKFLOW_HANDOFF_PREVIEW` — but note it is the answer a *successful*
 * read gives, never a stand-in for a failed one.
 */
export const EMPTY_HANDOFF_PREVIEW: HandoffPreviewLike = {
  handoff: false,
  workflow_name: "",
  from_status: "",
  to_status: "",
  handler_type: null,
  handler_id: null,
  previous_assignee_type: null,
  previous_assignee_id: null,
  previous_runs: [],
  brief: "",
};

/**
 * Run statuses that mean the agent is already working. `dispatched` counts:
 * the daemon has taken the run, so stopping it interrupts real work rather
 * than cancelling something that never began. Everything else — `queued`
 * above all — reads as not-started, which is why the copy offers "cancel"
 * instead of "stop" (upstream `started`).
 */
export const HANDOFF_HANDOFF_RUN_STATUSES = ["running", "dispatched"] as const;

/** Whether a run has actually begun. Unknown values read as "not started". */
export function isHandoffRunStarted(run: Pick<HandoffPreviewRun, "status">): boolean {
  return (HANDOFF_HANDOFF_RUN_STATUSES as readonly string[]).includes(run.status);
}

/** Which i18n plural family the elapsed-time copy uses. */
export type HandoffDurationKey = "under_minute" | "minutes" | "hours";

/**
 * How long the previous agent has been running, as a copy key plus its count.
 *
 * Buckets are upstream's exactly: under a minute (including "no start time",
 * which the server answers for a run that never recorded one) → `minutes`
 * below a full hour → `hours` from 60 minutes on. The 59/60 boundary is floor
 * arithmetic, not rounding, so 59.9 minutes is "59 minutes".
 *
 * A negative elapsed time (clock skew between server and phone) reads as
 * "under a minute" rather than a negative count — a run that *looks* like it
 * started in the future has, as far as the user is concerned, just started.
 */
export function handoffDurationKey(
  since: string | null,
  now: number = Date.now(),
): { key: HandoffDurationKey; count: number } {
  if (!since) return { key: "under_minute", count: 0 };
  const startedAt = new Date(since).getTime();
  // An unparseable timestamp is not a duration — treat it like a missing one.
  if (!Number.isFinite(startedAt)) return { key: "under_minute", count: 0 };
  const minutes = Math.floor((now - startedAt) / 60_000);
  if (minutes < 1) return { key: "under_minute", count: 0 };
  if (minutes < 60) return { key: "minutes", count: minutes };
  return { key: "hours", count: Math.floor(minutes / 60) };
}

/** The oldest run's start, or null when none recorded one. */
export function handoffOldestRunStart(
  runs: readonly HandoffPreviewRun[],
): string | null {
  return runs.reduce<string | null>(
    (oldest, run) =>
      !oldest || (run.started_at && run.started_at < oldest) ? run.started_at : oldest,
    null,
  );
}

/**
 * The column the move lands on. A plain status change takes what the user
 * picked — a stale preview must not relabel it. A **project move** lands on a
 * column the client cannot predict, so the server's `to_status` wins there;
 * with no preview yet it is empty (the dialog is still loading).
 */
export function handoffTargetStatus(input: {
  preview: HandoffPreviewLike | null;
  toStatus: string;
  toProject?: boolean;
}): string {
  const { preview, toStatus, toProject } = input;
  if (!toProject) return toStatus;
  return preview?.to_status ?? toStatus;
}

/**
 * Whether the previous assignee's runs should be offered as stoppable.
 * Upstream hides the whole stop box when the handler is the same actor: the
 * "previous" run is the incoming handler's own work.
 */
export function sameHandoffHandler(preview: HandoffPreviewLike): boolean {
  const { handler_type, handler_id, previous_assignee_type, previous_assignee_id } = preview;
  return (
    !!previous_assignee_id &&
    previous_assignee_id === handler_id &&
    previous_assignee_type === handler_type
  );
}

/** State of the preview read, as the dialog must render it. */
export type HandoffGateKind = "pending" | "error" | "noHandoff" | "confirm";

/**
 * What to do with the move, given the preview's read state.
 *
 * - `pending` — still checking; the dialog shows a spinner.
 * - `error` — the read failed. **Not** "no handoff": the dialog says the fact
 *   could not be established and refuses to confirm, because silently applying
 *   the move is the very behaviour this feature removes.
 * - `noHandoff` — the server positively said there is nothing to hand off
 *   (Default workflow, or a step that keeps the assignee). The move applies
 *   without asking, exactly as upstream does.
 * - `confirm` — there is a handoff; show the dialog.
 */
export function handoffGateKind(input: {
  isPending: boolean;
  isError: boolean;
  preview: HandoffPreviewLike | null;
}): HandoffGateKind {
  const { isPending, isError, preview } = input;
  // Failure is checked before `preview`: a stale cached body alongside an
  // error must not be read as a fresh answer.
  if (isError) return "error";
  if (isPending) return "pending";
  if (!preview) return "error";
  return preview.handoff ? "confirm" : "noHandoff";
}

/** Why the dialog cannot be confirmed, or null when it can. */
export type HandoffFailure = "unreadable";

/** The read state, flattened for the call site. */
export interface HandoffConfirmRead {
  state: HandoffGateKind;
  /** Non-null exactly when the dialog must explain itself and refuse. */
  failure: HandoffFailure | null;
  canConfirm: boolean;
}

/**
 * `handoffGateKind` plus the two consequences a caller must not re-derive:
 * whether the confirm button is live, and whether there is a failure to
 * explain. Kept together so a caller cannot take the state and then decide,
 * on its own, that `error` is close enough to `noHandoff`.
 */
export function handoffConfirmRead(input: {
  isPending: boolean;
  isError: boolean;
  preview: HandoffPreviewLike | null;
}): HandoffConfirmRead {
  const state = handoffGateKind(input);
  return {
    state,
    failure: state === "error" ? "unreadable" : null,
    canConfirm: state === "confirm" || state === "noHandoff",
  };
}

/**
 * The stop choice's initial value: ON.
 *
 * Upstream seeds `useState(true)` and the checkbox is not decorative — the
 * helper text promises that *not* stopping leaves two agents on one issue.
 * Defaulting to off would silently re-create the double-work hazard for every
 * user who taps straight through.
 */
export function handoffStopDefault(): boolean {
  return true;
}

/**
 * The write's control field, or `{}` when stopping is not applicable.
 *
 * Three conditions, all upstream's: the user wants it, there is something to
 * stop, and the handler is not the actor already assigned. Sending the flag in
 * any of those cases would either be a no-op or cancel the incoming handler's
 * own work.
 */
export function handoffStopPayload(input: {
  preview: HandoffPreviewLike | null;
  stop: boolean;
}): { stop_previous_assignee_runs?: true } {
  const { preview, stop } = input;
  if (!stop || !preview) return {};
  if (preview.previous_runs.length === 0) return {};
  if (sameHandoffHandler(preview)) return {};
  return { stop_previous_assignee_runs: true };
}

/** Which sentence describes the reassignment. */
export type HandoffSentenceKind = "sameHandler" | "reassign" | "reassignRun";

/**
 * The sentence the dialog leads with, or null when there is none to say.
 *
 * Null for a non-handoff and for an unusable handler — a sentence with a blank
 * actor name is worse than no sentence, and a drifted `handler_type` is exactly
 * how that happens. `reassignRun` is the agent/squad case because those start
 * work immediately; a member handler is told, but starts nothing.
 */
export function handoffSentenceKind(
  preview: HandoffPreviewLike | null,
): HandoffSentenceKind | null {
  if (!preview || !preview.handoff) return null;
  if (!preview.handler_type || !preview.handler_id) return null;
  if (sameHandoffHandler(preview)) return "sameHandler";
  return preview.handler_type === "member" ? "reassign" : "reassignRun";
}
