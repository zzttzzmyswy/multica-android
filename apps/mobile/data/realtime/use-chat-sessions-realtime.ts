/**
 * Chat sessions list-level realtime — Layer 3.
 *
 * Mounted globally in workspace `_layout.tsx` via `<RealtimeSubscriptions />`.
 * Keeps the chatKeys.sessions(wsId) cache fresh regardless of which tab
 * the user is on — so when they DO open Chat tab, the dropdown / sheet
 * already reflects reality (latest titles, has_unread flags, deletions).
 *
 * Events handled here are listing-level only — per-session events
 * (chat:message, task:*) belong in `use-chat-session-realtime.ts` because
 * they target a specific session id known only inside the chat screen.
 */
import { useQueryClient } from "@tanstack/react-query";
import { chatKeys } from "@/data/queries/chat";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";
import {
  dropSessionFromList,
  patchSessionListAfterUpdate,
} from "./chat-ws-updaters";

export function useChatSessionsRealtime() {
  const qc = useQueryClient();

  useWSSubscriptions(
    (ws, wsId) => {
      const invalidateSessions = () =>
        qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });

      // IM list "typing…" indicator (MYS-449): the in-flight chat task
      // aggregate is refreshed on task lifecycle transitions, debounced.
      // Mirrors web's refetchPendingChatAggregate / MUL-4159 — task events
      // are a workspace fanout with no creator info, so the aggregate is
      // NEVER patched optimistically; it is refetched through the
      // permission-filtering GET /api/chat/pending-tasks endpoint.
      // chat:message is intentionally NOT a trigger (fires per streamed
      // message — would be a request storm), same as web.
      let aggregateTimer: ReturnType<typeof setTimeout> | null = null;
      const invalidatePendingTasks = () => {
        if (aggregateTimer) clearTimeout(aggregateTimer);
        aggregateTimer = setTimeout(() => {
          aggregateTimer = null;
          qc.invalidateQueries({ queryKey: chatKeys.pendingTasks(wsId) });
        }, 750);
      };

      return [
        // chat:done flips `has_unread` server-side; refetch so the dot shows
        // even when the user isn't in the chat screen.
        ws.on("chat:done", () => {
          invalidateSessions();
          invalidatePendingTasks();
        }),
        // Cancellation may delete a queued prompt or append "Stopped.", both
        // of which change the session preview.
        ws.on("task:cancelled", () => {
          invalidateSessions();
          invalidatePendingTasks();
        }),
        // Lifecycle transitions refresh the pending-task aggregate so a
        // session row flips its typing indicator in place.
        ws.on("task:queued", invalidatePendingTasks),
        ws.on("task:dispatch", invalidatePendingTasks),
        ws.on("task:running", invalidatePendingTasks),
        ws.on("task:waiting_local_directory", invalidatePendingTasks),
        ws.on("task:completed", invalidatePendingTasks),
        ws.on("task:failed", invalidatePendingTasks),
        // chat:session_read clears the unread flag (could be triggered from
        // web/desktop on the same account).
        ws.on("chat:session_read", invalidateSessions),
        // chat:session_updated has no formal payload type yet — server
        // emits {chat_session_id, title?, updated_at?, pinned?}. Narrow inline.
        ws.on("chat:session_updated", (p) => {
          const payload = p as {
            chat_session_id: string;
            title?: string;
            updated_at?: string;
            pinned?: boolean;
          };
          patchSessionListAfterUpdate(qc, wsId, payload);
        }),
        ws.on("chat:session_deleted", (payload) => {
          dropSessionFromList(qc, wsId, payload);
        }),
        // Reconnect: we may have missed events while disconnected.
        ws.onReconnect(() => {
          invalidateSessions();
          invalidatePendingTasks();
        }),
      ];
    },
    [qc],
  );
}
