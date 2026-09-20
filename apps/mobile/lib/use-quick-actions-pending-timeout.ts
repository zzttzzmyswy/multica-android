/**
 * Clear a session's quick-actions pending marker when no `chat:quick_actions`
 * supplement resolves it before the marker's own deadline.
 *
 * Unlike a component-local timer this drops the REAL cache state, so the
 * spinner stops AND a later refresh — even after closing and reopening the
 * chat — starts clean instead of re-reading a stuck marker.
 *
 * The deadline is `marker.expires_at` (absolute), not a fresh window per
 * mount: switching between the session sheet and the chat tab unmounts one
 * host and mounts the other, and a per-mount timer would restart the full
 * wait each time, letting a lost event strand the marker indefinitely.
 * Reading the stored deadline means a remount waits only the remaining time.
 *
 * The clear is message-scoped so a late timer can never wipe a NEWER turn's
 * marker. Mirror of `useQuickActionsPendingTimeout` in
 * `packages/core/chat/use-quick-actions-pending-timeout.ts` — mobile cannot
 * import it, because it is bound to core's own key factory.
 *
 * Mount once per surface that reads the marker.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { chatKeys } from "@/data/queries/chat";
import {
  QUICK_ACTIONS_PENDING_TIMEOUT_MS,
  type ChatQuickActionsPendingState,
} from "@/lib/chat-quick-actions";

export function useQuickActionsPendingTimeout(
  sessionId: string | null,
  pending: ChatQuickActionsPendingState | null,
): void {
  const qc = useQueryClient();
  const messageId = pending?.message_id ?? null;
  const expiresAt = pending?.expires_at ?? null;

  useEffect(() => {
    if (!sessionId || !messageId) return;
    const clear = () =>
      qc.setQueryData<ChatQuickActionsPendingState | null>(
        chatKeys.quickActionsPending(sessionId),
        (current) => (current && current.message_id === messageId ? null : current),
      );
    // Remaining time to this marker's absolute deadline; a marker written
    // before the field existed falls back to a full window. An already-past
    // deadline clears on the next tick.
    const remaining =
      expiresAt != null
        ? expiresAt - Date.now()
        : QUICK_ACTIONS_PENDING_TIMEOUT_MS;
    const timer = setTimeout(clear, Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [qc, sessionId, messageId, expiresAt]);
}
