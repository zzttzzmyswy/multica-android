/**
 * Chat sessions list-level realtime wiring — the subscription list itself.
 *
 * Split out of `use-chat-sessions-realtime.ts` (which is now just the React
 * lifecycle shell) so the wiring is reachable from mobile's Node-only vitest
 * lane. The bug this exists to prevent is a MISSING invalidation on one
 * branch — exactly the kind of defect a source-text guard describes but a
 * behavioural test proves: the mobile lane has no RN renderer, so a hook can
 * only be exercised through a plan like this one.
 *
 * Every handler here is listing-level. Per-session traffic (chat:message,
 * per-task messages) belongs in `use-chat-session-realtime.ts`, because it
 * targets a session id known only inside the chat screen.
 */
import type { QueryClient } from "@tanstack/react-query";
import { chatKeys } from "@/data/queries/chat";
import type { WSClient } from "@/data/realtime/ws-client";
import {
  dropSessionFromList,
  patchSessionListAfterUpdate,
} from "./chat-ws-updaters";

/** The slice of the socket this module needs — keeps the test free of the
 *  transport's RN-facing surface (WebSocket global, client-identity). */
export type SessionsRealtimeSocket = Pick<WSClient, "on" | "onReconnect">;

/**
 * Registers the sessions-list subscriptions and returns their unsubs.
 * Mirrors web's `use-realtime-sync.ts` branch for branch; where mobile
 * deliberately differs, the handler says so.
 */
export function planChatSessionsSubscriptions(
  qc: QueryClient,
  ws: SessionsRealtimeSocket,
  wsId: string,
): (() => void)[] {
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
    // A FAILED chat turn is a visible outcome, not just a cleared pending
    // signal. `FailTask` persists the failure as an assistant chat_message
    // (`createAssistantChatMessage` in its terminal transaction), so the
    // session row's `last_message` (preview, `failure_reason`), its
    // `unread_count` and its sort position all changed — and `staleTime` is
    // Infinity across the chat caches, so without this invalidation nothing
    // would ever correct them: the row would keep the pre-failure preview
    // and a zero unread badge until a manual pull-to-refresh. Web's
    // `unsubTaskFailed` invalidates its session lists on the same reasoning.
    //
    // Gated on `chat_session_id`, which web also does and which matters more
    // on a phone: `task:failed` is a WORKSPACE fanout, so every issue-run
    // failure in the workspace reaches this handler. An ungated invalidate
    // would refetch the whole session list for a run that cannot alter any
    // session row.
    //
    // Deliberately NOT extended to `task:completed` above: the success path
    // persists its assistant row through `chat:done`, which already
    // invalidates — web's `unsubTaskCompleted` leaves the list alone too, and
    // mirroring the failure branch "for symmetry" would buy a second refetch
    // per completed turn for no new information.
    ws.on("task:failed", (payload) => {
      invalidatePendingTasks();
      if (payload.chat_session_id) invalidateSessions();
    }),
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
}
