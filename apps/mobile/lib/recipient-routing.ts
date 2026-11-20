/**
 * Comment "recipient routing" — the phone half of web's run steering
 * (`packages/core/issues/run-steering.ts` + `views/issues/hooks/
 * use-recipient-actions.ts`).
 *
 * ## The defect this closes
 *
 * The mobile composer knew only two things about a recipient: it will start,
 * or it is skipped. Web knows four, because a recipient that is ALREADY
 * running on this issue can receive the comment three different ways:
 *
 * | Action      | What happens to the running turn                       |
 * |-------------|--------------------------------------------------------|
 * | `steer`     | the turn reads the text at its next step (text only)   |
 * | `after_run` | the turn finishes untouched; a new run starts after    |
 * | `restart`   | the turn is stopped, then a fresh run starts over      |
 * | `start`     | nothing is running; this comment starts the run        |
 * | `skip`      | posted without triggering this recipient               |
 *
 * So on the phone, a user who wanted to correct an agent mid-flight had NO
 * way to say so: tapping the chip could only mean "skip", and posting the
 * comment silently queued a follow-up run behind the one they were trying to
 * correct. The agent kept working on the wrong thing until it finished.
 *
 * ## Why the decision is a pure function
 *
 * Two of the four actions are destructive-ish and all four change what the
 * server does with the comment, so the mapping has to be pinned by tests
 * rather than re-derived inline in a component. The rules mirror web
 * one-for-one; where mobile omits something, the comment says why.
 *
 * `start` is deliberately NOT in the steerable/busy sets: web emits it for
 * both idle and queued recipients, and the server folds a queued follow-up on
 * its own. Splitting it would be a distinction the user cannot act on.
 */
import type { AgentTask } from "@multica/core/types";

/**
 * The run-scoped capability a turn advertises when it can take more input.
 * Same literal as web (`TASK_SUPPLEMENT_CAPABILITY`); the server sends it on
 * every task row that negotiated the feature (`supplement_capability`), and
 * `can_supplement` is the per-viewer permission computed for the caller.
 *
 * Both must hold. A server that predates the feature sends neither, so the
 * old servers degrade to "not steerable" — which is exactly the behaviour
 * this build had before, not a new failure mode.
 */
export const TASK_SUPPLEMENT_CAPABILITY = "task-supplement-v1";

/** Statuses a message can still join. `deferred` is a parked retry — it has
 *  not run, so it counts as queued, matching web's ACTIVE_STATUSES. */
const ACTIVE_STATUSES = new Set<AgentTask["status"]>([
  "queued",
  "deferred",
  "dispatched",
  "waiting_local_directory",
  "running",
]);

export function isActiveTask(task: AgentTask): boolean {
  return ACTIVE_STATUSES.has(task.status);
}

/**
 * What one recipient is doing right now on this issue, which decides how a
 * message to it can be handled.
 */
export type AgentRunState =
  | { kind: "idle" }
  | { kind: "starting"; task: AgentTask }
  | { kind: "queued"; task: AgentTask }
  | { kind: "running"; task: AgentTask; steerable: boolean };

/**
 * Whether this task's running turn can take additional input FROM THIS USER.
 *
 * Capability and permission are separate checks on purpose: the server
 * negotiates the feature per runtime (`supplement_capability`) and answers
 * the permission question per caller (`can_supplement`). Trusting either
 * alone offers a menu entry the server will reject.
 */
export function isSteerableTask(task: AgentTask): boolean {
  return (
    task.status === "running" &&
    task.supplement_capability === TASK_SUPPLEMENT_CAPABILITY &&
    task.can_supplement === true
  );
}

/**
 * The recipient's state, from the issue's task list.
 *
 * A running turn wins over a queued follow-up: it is what a message actually
 * reaches right now, so it is the one the user is choosing about. `starting`
 * (dispatched / waiting for a local directory) is split from `queued` because
 * the label differs — "Starting" vs "Queued" — even though both take the same
 * actions.
 */
export function agentRunState(
  tasks: readonly AgentTask[],
  agentId: string,
): AgentRunState {
  let queued: AgentTask | undefined;
  let starting: AgentTask | undefined;
  for (const task of tasks) {
    if (task.agent_id !== agentId) continue;
    if (task.status === "running") {
      return { kind: "running", task, steerable: isSteerableTask(task) };
    }
    if (
      task.status === "dispatched" ||
      task.status === "waiting_local_directory"
    ) {
      starting ??= task;
    } else if (task.status === "queued" || task.status === "deferred") {
      queued ??= task;
    }
  }
  if (starting) return { kind: "starting", task: starting };
  if (queued) return { kind: "queued", task: queued };
  return { kind: "idle" };
}

/** How a message reaches one recipient. */
export type RecipientAction =
  /** Into the running turn, read at its next step. Text only. */
  | "steer"
  /** Normal trigger while the recipient is busy: handled once this turn ends. */
  | "after_run"
  /** Stop the current turn, then start over with this message. */
  | "restart"
  /** Normal trigger for an idle recipient, or one whose run is still queued. */
  | "start"
  /** Post without triggering this recipient. */
  | "skip";

export interface RecipientActionOptions {
  /** False while editing, or when the message carries files: a running turn
   *  takes text only, so an attachment silently changes the answer. */
  canSteer: boolean;
  /** False while editing: an edit never stops a run. */
  canRestart: boolean;
  /** Whether THIS composer takes a running turn by default. */
  steerByDefault: boolean;
}

/**
 * The actions to offer, in the order the menu shows them. The order is part
 * of the contract: `start`/`skip` readers take `actions[0]` as the default,
 * so "skip" must never come first for a live recipient.
 */
export function recipientActions(
  state: AgentRunState,
  opts: RecipientActionOptions,
): RecipientAction[] {
  if (state.kind === "idle" || state.kind === "queued") return ["start", "skip"];
  const actions: RecipientAction[] = [];
  if (state.kind === "running" && state.steerable && opts.canSteer) {
    actions.push("steer");
  }
  actions.push("after_run");
  if (opts.canRestart) actions.push("restart");
  actions.push("skip");
  return actions;
}

/**
 * The action actually used: the user's choice while it is still available,
 * otherwise the default.
 *
 * "Still available" is the important half. A turn can end between the menu
 * opening and the send, and a file can be attached after "steer" was picked —
 * in both cases the chosen action is gone and sending it would either be
 * rejected by the server or silently do something else.
 */
export function resolveRecipientAction(
  state: AgentRunState,
  chosen: RecipientAction | undefined,
  opts: RecipientActionOptions,
): RecipientAction {
  const actions = recipientActions(state, opts);
  if (chosen && actions.includes(chosen)) return chosen;
  if (opts.steerByDefault && actions.includes("steer")) return "steer";
  return actions.find((action) => action !== "steer")!;
}

/** Everything the submit call needs, derived from the per-recipient choices. */
export interface RecipientRouting {
  suppressAgentIds: string[];
  /** The exact running turns chosen. A turn that ends first is never swapped
   *  for another one — the server falls back to a normal trigger instead. */
  steerTaskIds: string[];
  /** Turns to stop before the comment is posted, so it starts a fresh run. */
  restartTaskIds: string[];
}

export function recipientRouting(
  recipients: readonly {
    agentId: string;
    action: RecipientAction;
    state: AgentRunState;
  }[],
): RecipientRouting {
  const routing: RecipientRouting = {
    suppressAgentIds: [],
    steerTaskIds: [],
    restartTaskIds: [],
  };
  for (const { agentId, action, state } of recipients) {
    if (action === "skip") routing.suppressAgentIds.push(agentId);
    else if (action === "steer" && state.kind === "running") {
      routing.steerTaskIds.push(state.task.id);
    } else if (action === "restart" && state.kind !== "idle") {
      routing.restartTaskIds.push(state.task.id);
    }
  }
  return routing;
}

/**
 * Whether a recipient would take this message inside its running turn while
 * the message carries files.
 *
 * The server would accept the comment but the running turn cannot receive the
 * attachment, so the file would land only on the follow-up — the user is told
 * before sending instead of discovering it afterwards. Web renders
 * `steer_attachment_notice` for exactly this state.
 */
export function attachmentsBlockSteer(
  recipients: readonly {
    agentId: string;
    action: RecipientAction;
    state: AgentRunState;
  }[],
  hasAttachments: boolean,
  canSteer: boolean,
): boolean {
  if (!hasAttachments || !canSteer) return false;
  return recipients.some(
    (r) => r.action === "steer" && r.state.kind === "running" && r.state.steerable,
  );
}

/**
 * Agents whose trigger choices must be forgotten because they are no longer
 * recipients (an @mention was edited away). Mirrors web's prune effect: a
 * stale "skip" would otherwise suppress an agent the user has re-mentioned.
 */
export function pruneRecipientChoices(
  chosen: Readonly<Record<string, RecipientAction>>,
  agentIds: readonly string[],
): Record<string, RecipientAction> {
  const visible = new Set(agentIds);
  const next: Record<string, RecipientAction> = {};
  let changed = false;
  for (const [id, action] of Object.entries(chosen)) {
    if (visible.has(id)) next[id] = action;
    else changed = true;
  }
  return changed ? next : (chosen as Record<string, RecipientAction>);
}
