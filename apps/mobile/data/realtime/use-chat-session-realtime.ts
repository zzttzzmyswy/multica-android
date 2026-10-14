/**
 * Per-session chat realtime — Layer 3.
 *
 * Mounted by the chat screen with the active session id; cleans up on
 * navigate-away. All handlers self-gate on `chat_session_id === sessionId`
 * so a backgrounded session (user switched sessions in the sheet but kept
 * the chat tab open) doesn't keep mutating caches it no longer owns.
 *
 * Events handled:
 *   - chat:message              → invalidate messages + pendingTask
 *   - chat:done                 → patch messages inline + refresh pendingTask
 *   - chat:quick_actions        → patch the async quick-actions supplement
 *                                  onto the assistant message
 *   - task:queued / dispatch    → seed / promote pendingTask
 *   - task:cancelled            → refresh pendingTask + messages
 *   - chat:cancel_finalized     → the deferred cancellation outcome: insert a
 *                                  late "Stopped." row, or evict the deleted
 *                                  prompt and re-pull the durable restores
 *   - task:completed            → no-op for messages (chat:done already
 *                                  wrote the assistant message); just
 *                                  refresh pendingTask
 *   - task:failed               → refresh pendingTask + invalidate messages
 *                                  (FailTask persists a failure assistant
 *                                  message that must show up)
 *   - chat:session_deleted      → fire onSessionDeleted() so the screen
 *                                  can drop the active id and unwind UI
 *   - reconnect                 → invalidate this session's messages +
 *                                  pendingTask
 */
import { useQueryClient } from "@tanstack/react-query";
import type { ChatCancelFinalizedPayload } from "@multica/core/types";
import { chatKeys } from "@/data/queries/chat";
import { useAuthStore } from "@/data/auth-store";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";
import {
  appendTaskMessage,
  applyChatCancelFinalizedToCache,
  applyChatDoneToCache,
  applyChatQuickActionsToCache,
  invalidatePendingTask,
  promotePendingTaskToRunning,
  seedPendingTaskFromQueued,
} from "./chat-ws-updaters";

export function useChatSessionRealtime(
  sessionId: string | null,
  onSessionDeleted?: () => void,
) {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);

  useWSSubscriptions(
    (ws) => {
      if (!sessionId) return;

      const isMine = (p: { chat_session_id?: string }) =>
        p.chat_session_id === sessionId;

      const invalidateMine = () => {
        qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
        qc.invalidateQueries({ queryKey: chatKeys.pendingTask(sessionId) });
        // A `chat:cancel_finalized` broadcast missed while disconnected is
        // exactly what the durable draft-restore rows exist for (#5219) —
        // re-pull them so a mounted composer recovers the prompt without a
        // remount. Mirrors web's reconnect invalidation of
        // `chatKeys.draftRestoresAll()`.
        qc.invalidateQueries({ queryKey: chatKeys.draftRestores(sessionId) });
      };

      return [
        // User-message echo from another device; we may also receive our own
        // sends echoed back, but the id-dedupe in the cache write handles
        // that. Invalidate is cheap — chat:message is rare in practice.
        ws.on("chat:message", (payload) => {
          if (!isMine(payload)) return;
          qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
          qc.invalidateQueries({ queryKey: chatKeys.pendingTask(sessionId) });
        }),
        ws.on("chat:done", (payload) => {
          if (!isMine(payload)) return;
          applyChatDoneToCache(qc, payload);
        }),
        // The daemon's background suggestion pass lands here, after chat:done
        // already refetched an actions-less message list. Patch the actions in
        // directly — staleTime is Infinity, so nothing would refetch them.
        ws.on("chat:quick_actions", (payload) => {
          if (!isMine(payload)) return;
          void applyChatQuickActionsToCache(qc, payload);
        }),
        ws.on("task:queued", (payload) => {
          if (!isMine(payload)) return;
          seedPendingTaskFromQueued(qc, payload);
        }),
        ws.on("task:dispatch", (payload) => {
          if (!isMine(payload)) return;
          promotePendingTaskToRunning(qc, payload);
        }),
        ws.on("task:cancelled", (payload) => {
          if (!isMine(payload)) return;
          invalidatePendingTask(qc, sessionId);
          qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
        }),
        // Deferred cancellation outcome (#5219): the server settles the
        // empty/non-empty judgment only after the daemon acked its transcript
        // flush, so this arrives seconds after the cancel HTTP response — and
        // nothing else refetches at that point. Without it a client that
        // cancelled while backgrounded would keep rendering the deleted bubble,
        // and its composer would never learn to look for the durable restore.
        ws.on("chat:cancel_finalized", (payload) => {
          if (!isMine(payload)) return;
          applyChatCancelFinalizedToCache(
            qc,
            payload as ChatCancelFinalizedPayload,
            userId,
          );
        }),
        ws.on("task:completed", (payload) => {
          if (!isMine(payload)) return;
          invalidatePendingTask(qc, sessionId);
        }),
        ws.on("task:failed", (payload) => {
          if (!isMine(payload)) return;
          // FailTask persists a destructive assistant message — surface it
          // and recover any queued successor from the authoritative endpoint.
          invalidatePendingTask(qc, sessionId);
          qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
        }),
        ws.on("chat:session_deleted", (payload) => {
          if (!isMine(payload)) return;
          onSessionDeleted?.();
        }),
        // Live execution trace for any task firing under this chat session.
        // Per-record gate: `chat_session_id` is optional on the payload
        // (issue tasks also fire `task:message`), so non-chat traffic is
        // filtered out here. The cache is keyed on `task_id` rather than
        // `sessionId`, so completed tasks still render their trace under the
        // assistant bubble after the live pill unmounts.
        ws.on("task:message", (payload) => {
          if (!isMine(payload)) return;
          appendTaskMessage(qc, payload);
        }),
        ws.onReconnect(invalidateMine),
      ];
    },
    [sessionId, qc, onSessionDeleted, userId],
  );
}
