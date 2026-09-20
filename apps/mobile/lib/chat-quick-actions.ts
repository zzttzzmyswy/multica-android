/**
 * Hide the reserved agent-to-server quick-action footer while a response is
 * still streaming. Persisted message content is already stripped server-side;
 * this closes the short window where an incomplete JSON fence could otherwise
 * flash in the live timeline.
 *
 * Mirror of `stripChatQuickActionsProtocol` in
 * `packages/views/chat/lib/quick-actions.ts` — mobile owns its own copy per
 * the mirror-don't-import rule in apps/mobile/CLAUDE.md. Behaviour must stay
 * byte-for-byte identical; `chat-quick-actions.test.ts` pins the three cases
 * that distinguish it from a naive "cut at the fence" (a fence followed by
 * real prose is an ordinary example, not the reserved footer).
 */
export function stripChatQuickActionsProtocol(content: string): string {
  const matches = [
    ...content.matchAll(/(?:^|\r?\n)```quick-actions(?:\r?\n|$)/g),
  ];
  const match = matches.at(-1);
  if (!match || match.index == null) return content;

  const footerStart = match.index;
  const bodyStart = footerStart + match[0].length;
  const closingFence = /\r?\n```/.exec(content.slice(bodyStart));
  if (closingFence) {
    const afterFence = content.slice(
      bodyStart + closingFence.index + closingFence[0].length,
    );
    // Once later prose arrives, this was an ordinary example in the reply,
    // not the reserved trailing footer.
    if (afterFence.trim() !== "") return content;
  }

  return content.slice(0, footerStart).trimEnd();
}

/**
 * How long a client waits for a `chat:quick_actions` supplement before giving
 * up on the pending marker. Mirrors `QUICK_ACTIONS_PENDING_TIMEOUT_MS` in
 * `packages/core/chat/queries.ts:23`.
 */
export const QUICK_ACTIONS_PENDING_TIMEOUT_MS = 12_000;

/**
 * Client-only marker (never persisted, never fetched) that the identified
 * turn's quick-actions supplement is still in flight — it drives the refresh
 * spinner and the skeleton between the refresh tap (or `chat:done`) and the
 * `chat:quick_actions` event.
 *
 * Mirror of `ChatQuickActionsPendingState` in
 * `packages/core/types/chat.ts:43` — mobile owns its own copy per the
 * mirror-don't-import rule, and only the fields it actually reads.
 */
export interface ChatQuickActionsPendingState {
  message_id: string;
  task_id: string;
  /**
   * Absolute epoch-ms deadline after which the client stops waiting for the
   * supplement and clears the marker. Stored ON the marker rather than held in
   * a component timer so that switching chat surfaces — which unmounts one
   * host and mounts another — resumes the same deadline instead of re-arming a
   * fresh window each time and letting a lost event strand the spinner.
   */
  expires_at: number;
}
