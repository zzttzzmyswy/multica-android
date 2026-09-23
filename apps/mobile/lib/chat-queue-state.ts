/**
 * Chat session row queue state — pure, i18n-free.
 *
 * See chat-queue-state.test.ts for why only a definitive "offline" downgrades.
 */

export type ChatQueueState = "typing" | "waiting";

/**
 * The queue state to render for a session, or null when nothing is queued
 * (the caller falls through to its other preview states).
 *
 * @param isRunning     a pending task exists for this session
 * @param availability  the agent's presence availability, or undefined/null
 *                      when presence is still loading or the agent is unknown
 */
export function deriveChatQueueState(
  isRunning: boolean,
  availability: string | null | undefined,
): ChatQueueState | null {
  if (!isRunning) return null;
  return availability === "offline" ? "waiting" : "typing";
}
