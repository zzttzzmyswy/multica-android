/**
 * Resolving the agent a chat session is bound to.
 *
 * Web (`packages/views/chat/components/chat-window.tsx`) resolves the open
 * session's agent from the **archived-inclusive** agent list, and says why:
 * an archived agent is filtered out of the *available* list, so resolving from
 * that list alone loses the session's identity — wrong avatar/name, and a
 * composer that claims there is no agent. The archived state then makes the
 * conversation read-only history. Mobile mirrors both halves here.
 */
import type { Agent } from "@multica/core/types";

/**
 * The session's agent, resolved from an archived-inclusive list. `null` when
 * the id is absent or the agent no longer exists at all (deleted, not
 * archived — an archived agent still resolves).
 */
export function resolveSessionAgent(
  agents: readonly Agent[],
  agentId: string | null | undefined,
): Agent | null {
  if (!agentId) return null;
  return agents.find((a) => a.id === agentId) ?? null;
}

/**
 * The agent is retired: it can no longer pick up work, so the conversation is
 * read-only. `false` for a missing agent — "no agent" is a different state,
 * and the chat banner slot falls through to its other branches for it.
 */
export function isAgentArchived(
  agent: Pick<Agent, "archived_at"> | null | undefined,
): boolean {
  return Boolean(agent?.archived_at);
}
