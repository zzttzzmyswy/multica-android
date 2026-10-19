/**
 * Gate + navigation decisions for the agent detail screen's two primary
 * actions — "Chat with this agent" and "Assign work".
 *
 * Mirrors web `packages/views/agents/components/agent-detail-page.tsx`:
 *
 *   - `:278-292` `handleDm` — a real link to `${chat()}?agent=<id>`, but a
 *     denied gate cancels the navigation and explains itself.
 *   - `:293-300` `handleAssign` — no link; if the agent has no runtime the
 *     toast names that reason and nothing happens, otherwise the quick-create
 *     dialog opens prefilled with this agent.
 *   - `:521-542` — **both buttons stay mounted** while a gate denies. Chat
 *     hides only when archived; Assign hides when `canAssign` is false. Every
 *     other denial is a button press that explains itself.
 *
 * That last point is the contract this module exists to protect. The tempting
 * mobile implementation is to hide a button the user may not use, but that is
 * exactly what web avoids: an affordance that silently disappears tells the
 * user the capability does not exist, when the truth is usually "not for this
 * agent" (a private agent owned by someone else) or "not yet" (membership
 * still loading). Those are different facts and only one of them is
 * actionable.
 *
 * Kept pure (no React, no router) so the decisions can be tested directly —
 * the failure mode here is a silently missing or silently dead button, which
 * no type checker catches.
 */
import type { Agent } from "@multica/core/types";

/** What a primary action should do when pressed. */
export type AgentPrimaryActionOutcome =
  /** Navigate / proceed. */
  | { kind: "proceed" }
  /** Stay put and show this message. */
  | { kind: "blocked"; reason: AgentPrimaryActionBlockReason };

export type AgentPrimaryActionBlockReason =
  /** Membership is still resolving — the decision is undetermined. */
  | "permissions_loading"
  /** The viewer may not invoke this agent (private / not granted). */
  | "no_permission"
  /** Assigning needs a bound runtime; an unbound agent would fail on send. */
  | "runtime_required";

export interface AgentPrimaryActionInput {
  /** Agent the screen is showing. */
  agent: Pick<Agent, "runtime_id" | "runtime_bound">;
  /** `canAssignAgentToIssue(...).allowed`. */
  canAssign: boolean;
  /** True while the member query is in flight. */
  permissionsLoading: boolean;
  /** Whether the agent has a runtime bound (`isAgentRuntimeBound`). */
  runtimeBound: boolean;
}

/**
 * Decision for "Chat with this agent".
 *
 * Order matters and follows web exactly:
 *
 *   1. **loading** → blocked, but with the "undetermined" reason rather than a
 *      permission denial. Web renders the button *disabled* in this state
 *      (`dmPending`) so the tap never lands; mobile has no disabled anchor, so
 *      it stays tappable and says the check is still running. Either way the
 *      user is never told "no permission" while the answer is unknown.
 *   2. **!canAssign** → blocked, "no permission".
 *   3. **!runtimeBound** → blocked, "runtime required". Web applies this gate
 *      to chat as well as assign (`handleDm`'s last branch), because sending a
 *      message starts a run.
 */
export function decideChatAction({
  canAssign,
  permissionsLoading,
  runtimeBound,
}: AgentPrimaryActionInput): AgentPrimaryActionOutcome {
  if (permissionsLoading) return { kind: "blocked", reason: "permissions_loading" };
  if (!canAssign) return { kind: "blocked", reason: "no_permission" };
  if (!runtimeBound) return { kind: "blocked", reason: "runtime_required" };
  return { kind: "proceed" };
}

/**
 * Decision for "Assign work".
 *
 * Web's `handleAssign` checks ONLY the runtime (`:293-300`) — the button is
 * not even rendered when `canAssign` is false, so the permission case cannot
 * be reached there. Mobile keeps the button mounted (see the module doc), so
 * this reports the permission denial too: it is the honest answer for a press
 * that web would not have offered.
 *
 * Runtime is checked before permission? No — permission first, matching the
 * chat action: "you may not use this agent at all" is a more fundamental fact
 * than "this agent is not ready to run", and a user who can never invoke the
 * agent should not be told to go bind a runtime they cannot use.
 */
export function decideAssignAction({
  canAssign,
  permissionsLoading,
  runtimeBound,
}: AgentPrimaryActionInput): AgentPrimaryActionOutcome {
  if (permissionsLoading) return { kind: "blocked", reason: "permissions_loading" };
  if (!canAssign) return { kind: "blocked", reason: "no_permission" };
  if (!runtimeBound) return { kind: "blocked", reason: "runtime_required" };
  return { kind: "proceed" };
}

/**
 * Whether each primary action should be MOUNTED at all.
 *
 * Web mounts Chat for every non-archived agent (`:520`) and Assign only when
 * `canAssign` (`:537`). Archived agents get neither — the profile is read-only
 * history at that point, and offering "chat" on it would start a run against
 * an agent that cannot take one.
 *
 * Note this is deliberately NOT the same predicate as the press-time gate:
 * mounting depends on archived-ness (a fact), pressing depends on permissions
 * and runtime (a decision). Collapsing the two is what makes buttons vanish
 * when they should explain themselves.
 */
export function agentPrimaryActionVisibility(
  // `status` is widened to `string` on purpose: `AgentStatus` has no
  // "archived" member, but the rest of this screen already treats a literal
  // "archived" status as archived (`agent-detail-actions.tsx`), so a server
  // that ever starts sending it must degrade to "archived" rather than to
  // "active". A narrower type would turn that guard into dead code the
  // compiler silently accepts.
  agent: { archived_at: string | null; status: string },
  canAssign: boolean,
): { chat: boolean; assign: boolean } {
  const archived = !!agent.archived_at || String(agent.status) === "archived";
  if (archived) return { chat: false, assign: false };
  return { chat: true, assign: canAssign };
}

/**
 * The chat deep link web uses (`agent-detail-page.tsx:313`):
 * `${paths.chat()}?agent=<id>`. Mobile's chat tab reads the same `agent` query
 * param (see `(tabs)/chat.tsx`), so the shape is shared rather than invented
 * per platform.
 */
export function agentChatHref(wsSlug: string, agentId: string): string {
  return `/${wsSlug}/chat?agent=${encodeURIComponent(agentId)}`;
}
