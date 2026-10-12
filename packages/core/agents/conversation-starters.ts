import type { Agent, AgentConversationStarter } from "../types";
import {
  AGENT_CONVERSATION_STARTERS_MAX,
  AGENT_CONVERSATION_STARTER_LABEL_MAX_LENGTH,
  AGENT_CONVERSATION_STARTER_MAX_LENGTH,
} from "./constants";

/**
 * Resolve what a new chat with this agent actually shows.
 *
 * A configured suggestion only counts once BOTH halves carry text: the editor
 * lets an author add a row and save is blocked while it is half-filled, but a
 * malformed payload from an older client must not render a blank button.
 *
 * When nothing complete survives, the caller's localized fallbacks are used
 * and `isFallback` says so — the settings preview needs to tell an author
 * "these are the defaults" rather than implying they configured them.
 */
export function selectConversationStarters(
  configured: AgentConversationStarter[] | undefined | null,
  fallback: AgentConversationStarter[],
): { starters: AgentConversationStarter[]; isFallback: boolean } {
  const complete = (configured ?? []).filter(
    (item) => item.label.trim() !== "" && item.prompt.trim() !== "",
  );
  return complete.length > 0
    ? { starters: complete, isFallback: false }
    : { starters: fallback, isFallback: true };
}

/**
 * Whether this viewer should be offered a way to edit the agent's conversation
 * starters from the chat empty state they render in.
 *
 * Three independent reasons to stay silent, each of which would otherwise
 * produce a link that lies:
 *
 *  - no agent, or an archived one: its conversations are read-only, so
 *    editing its starters changes nothing anyone will see,
 *  - a backend that does not persist conversation starters: the agent editor
 *    renders no starter surface there, so the link lands somewhere that cannot
 *    honour it,
 *  - a viewer who cannot edit the agent: a reader would arrive at a page they
 *    have no write access to.
 */
export function canCustomizeConversationStarters(
  agent: Pick<Agent, "archived_at"> | null,
  opts: { conversationStartersSupported: boolean; canEditAgent: boolean },
): boolean {
  if (!agent || agent.archived_at) return false;
  if (!opts.conversationStartersSupported) return false;
  return opts.canEditAgent;
}

/**
 * Whether an agent's starter rows are ready to be written.
 *
 * Every row must carry both halves: the server stores the array verbatim, so
 * a half-filled row would persist and then render as a button labelled with an
 * empty string — or, once `selectConversationStarters` filters it, silently
 * hand the reader the fallbacks instead, leaving the author certain they saved
 * something they did not. The editor uses this to block save with a visible
 * reason rather than dropping the row behind the author's back.
 */
export function conversationStartersWithinLimits(
  starters: readonly AgentConversationStarter[],
): boolean {
  if (starters.length > AGENT_CONVERSATION_STARTERS_MAX) return false;
  return starters.every(
    (item) =>
      item.label.trim() !== "" &&
      item.prompt.trim() !== "" &&
      [...item.label].length <= AGENT_CONVERSATION_STARTER_LABEL_MAX_LENGTH &&
      [...item.prompt].length <= AGENT_CONVERSATION_STARTER_MAX_LENGTH,
  );
}

/**
 * The starter rows as the wire expects them: complete rows only, trimmed, and
 * never more than the server accepts. Shared by create, update and the builder
 * so no path can submit a shape the others would not — the builder's reply is
 * model-generated and can carry any array at all, while the editor's rows are
 * already bounded by `maxLength`; both end up here.
 */
export function normalizeConversationStarters(
  starters: readonly AgentConversationStarter[],
): AgentConversationStarter[] {
  return starters
    .filter((item) => item.label.trim() !== "" && item.prompt.trim() !== "")
    .slice(0, AGENT_CONVERSATION_STARTERS_MAX)
    .map((item) => ({
      label: [...item.label.trim()]
        .slice(0, AGENT_CONVERSATION_STARTER_LABEL_MAX_LENGTH)
        .join(""),
      prompt: [...item.prompt.trim()]
        .slice(0, AGENT_CONVERSATION_STARTER_MAX_LENGTH)
        .join(""),
    }));
}
