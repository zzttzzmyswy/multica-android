/**
 * Chat query keys + queryOptions factories.
 *
 * Keys:
 *   - sessions(wsId)        → ChatSession[] for the workspace dropdown / sheet
 *   - messages(sessionId)   → ChatMessage[] for the active session
 *   - pendingTask(sessionId)→ ChatPendingTask, populated when an agent task is
 *                             in flight; refreshed on terminal task events
 *   - pendingTasks(wsId)    → aggregate in-flight chat tasks (the IM list's
 *                             "typing…" indicator, web parity)
 *
 * Same shape as web's `chatKeys` in packages/core/chat/queries.ts (mobile
 * owns its own copy per the "mirror, don't import" rule in apps/mobile/CLAUDE.md).
 *
 * `staleTime: Infinity` everywhere — caches are kept fresh by WS event
 * handlers, not by background refetch. Foreground / reconnect invalidates
 * are scoped to each owning hook (see use-chat-sessions-realtime.ts and
 * use-chat-session-realtime.ts).
 */
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { ChatMessage, ChatSession } from "@multica/core/types";
import { api } from "@/data/api";
import { pendingTaskPollMs } from "@/lib/chat-task-polling";
import {
  EMPTY_CHAT_MESSAGES_PAGE_STATE,
  mergeNewestMessages,
  mergeOlderMessages,
  pageStateFrom,
  type ChatMessagesPageState,
} from "@/lib/chat-message-page";

export const chatKeys = {
  all: (wsId: string | null) => ["chat", wsId] as const,
  sessions: (wsId: string | null) =>
    [...chatKeys.all(wsId), "sessions"] as const,
  messages: (sessionId: string) => ["chat", "messages", sessionId] as const,
  /** Cursor bookkeeping for "load older" — `{hasMore, cursor}`. Kept OUT of
   *  the messages cache on purpose: that cache stays a flat ascending
   *  `ChatMessage[]` because WS appends, optimistic sends and
   *  `hideQueuedChatMessages` all read it as one array. Web can use an
   *  infinite query (`chatKeys.messagesPage`) because its page cache is
   *  separate from the realtime one; mobile's realtime path writes the flat
   *  cache directly, so the cursor needs its own slot. */
  messagesPage: (sessionId: string) =>
    ["chat", "messages-page", sessionId] as const,
  pendingTask: (sessionId: string) =>
    ["chat", "pending-task", sessionId] as const,
  /** Client-only marker (never fetched): this session's latest assistant turn
   *  is awaiting a refreshed quick-actions supplement. Drives the refresh
   *  spinner and the skeleton between the refresh tap and the
   *  `chat:quick_actions` event. Mirrors web's `quickActionsPending`. */
  quickActionsPending: (sessionId: string) =>
    ["chat", "quick-actions-pending", sessionId] as const,
  /** Per-task live execution timeline (thinking / tool_use / tool_result /
   *  text / error rows). Cache is workspace-agnostic — keyed only on
   *  `taskId` — matching web's `chatKeys.taskMessages` shape so future
   *  cross-feature consumers (issue agent cards) can share the cache.
   *  `task:message` WS events append rows in place; once the task
   *  completes the cache stays warm so the persisted assistant message
   *  can render the same trace without refetching. */
  taskMessages: (taskId: string) => ["task-messages", taskId] as const,
  /** Aggregate of in-flight chat tasks for the current user in this workspace —
   *  the IM session list's "typing…" indicator (web `chatKeys.pendingTasks`). */
  pendingTasks: (wsId: string | null) =>
    [...chatKeys.all(wsId), "pending-tasks"] as const,
};

// UUID gate mirrors `packages/core/chat/queries.ts`: optimistic task ids
// (`optimistic-…`) are not real backend rows, so the query must be
// disabled until we have a server-issued UUID. Returning the cache for
// an optimistic id would 404 the API.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTaskMessageTaskId(
  taskId: string | null | undefined,
): taskId is string {
  return typeof taskId === "string" && UUID_PATTERN.test(taskId);
}

/**
 * Orders the chat list the same way web + the server do: pinned chats first,
 * then everyone else by most-recent activity. Used both to render the session
 * sheet and to re-sort the cache after an optimistic pin/unpin or a WS patch,
 * so a mutated flat cache never renders out of order. Returns a new array;
 * stable for equal keys (Array.prototype.sort is stable), so pinned rows keep
 * their server order when pin timestamps aren't carried in the list payload.
 *
 * Mirrors `sortChatSessions` in `packages/core/chat/queries.ts` — activity is
 * ranked on `last_message.created_at` when present (web parity), falling back
 * to `updated_at` for sessions without a last message.
 */
export function sessionActivityTime(s: ChatSession): number {
  return new Date(s.last_message?.created_at ?? s.updated_at).getTime();
}

export function sortChatSessions(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => {
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return sessionActivityTime(b) - sessionActivityTime(a);
  });
}

/**
 * Splits the flat sessions cache into the two list views (web
 * `chat-thread-list.tsx` splits the same flat cache on `status` locally):
 * active chats fill the default history view, archived chats fill the
 * Archived view. Each bucket is sorted pinned-first then by activity.
 */
export function splitChatSessions(
  sessions: ChatSession[],
): { history: ChatSession[]; archived: ChatSession[] } {
  const history: ChatSession[] = [];
  const archived: ChatSession[] = [];
  for (const s of sessions) {
    (s.status === "archived" ? archived : history).push(s);
  }
  return {
    history: sortChatSessions(history),
    archived: sortChatSessions(archived),
  };
}

export const chatSessionsOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: chatKeys.sessions(wsId),
    // `status: all` mirrors web's chatSessionsOptions — the sheet splits the
    // flat cache into a history and an Archived view locally, so the server
    // must return active AND archived sessions or the archived view is empty.
    queryFn: ({ signal }) => api.listChatSessions({ signal, status: "all" }),
    enabled: !!wsId,
    staleTime: Infinity,
  });

export const chatMessagesOptions = (sessionId: string | null) =>
  queryOptions({
    queryKey: chatKeys.messages(sessionId ?? ""),
    queryFn: async ({ signal, client }) => {
      const page = await api.listChatMessagesPage(sessionId!, { signal });
      // Seed the cursor from the FIRST page only. This queryFn runs once per
      // session (`staleTime: Infinity`, and every later mutation patches the
      // flat cache rather than refetching), so the window can never be
      // re-truncated underneath a user who has already loaded older history.
      client.setQueryData<ChatMessagesPageState>(
        chatKeys.messagesPage(sessionId!),
        pageStateFrom(page),
      );
      // Merge rather than replace: the chat screen re-fetches this query when
      // a turn finishes, and a reader may be deep in scrollback by then. A
      // replace would drop every page they had loaded.
      const prev =
        client.getQueryData<ChatMessage[]>(chatKeys.messages(sessionId!)) ?? [];
      return mergeNewestMessages(prev, page.messages);
    },
    enabled: !!sessionId,
    staleTime: Infinity,
  });

/**
 * Sessions with an older-page request in flight. The list's `onStartReached`
 * fires on every scroll frame near the top, and the network on cellular is
 * slow enough that a user can easily trigger a dozen before the first lands —
 * each would fetch the same cursor and prepend the same rows.
 */
const olderPageInFlight = new Set<string>();

/**
 * Fetch the page before the current window and prepend it to the flat
 * messages cache. Returns true when the window grew.
 *
 * Mirrors `fetchNextPage` on web's `chatMessagesPageOptions`
 * (packages/core/chat/queries.ts:144-155), with the difference that the
 * prepend target is the flat realtime cache rather than `InfiniteData.pages`.
 */
export async function loadOlderChatMessages(
  qc: QueryClient,
  sessionId: string,
): Promise<boolean> {
  const pageState =
    qc.getQueryData<ChatMessagesPageState>(chatKeys.messagesPage(sessionId)) ??
    EMPTY_CHAT_MESSAGES_PAGE_STATE;
  if (!pageState.hasMore || !pageState.cursor) return false;
  if (olderPageInFlight.has(sessionId)) return false;

  olderPageInFlight.add(sessionId);
  try {
    const page = await api.listChatMessagesPage(sessionId, {
      before: pageState.cursor,
    });
    const prev =
      qc.getQueryData<ChatMessage[]>(chatKeys.messages(sessionId)) ?? [];
    const merged = mergeOlderMessages(prev, page.messages);
    if (merged !== prev) {
      qc.setQueryData(chatKeys.messages(sessionId), merged);
    }
    // Advance the cursor even when the merge was a no-op. A page whose rows
    // were all already present (a message landed between request and response,
    // shifting the window) must still move the anchor forward, or the next
    // scroll would re-request the exact same page forever.
    qc.setQueryData<ChatMessagesPageState>(
      chatKeys.messagesPage(sessionId),
      pageStateFrom(page),
    );
    return merged !== prev;
  } finally {
    olderPageInFlight.delete(sessionId);
  }
}

export const pendingChatTaskOptions = (sessionId: string | null) =>
  queryOptions({
    queryKey: chatKeys.pendingTask(sessionId ?? ""),
    queryFn: ({ signal }) => api.getPendingChatTask(sessionId!, { signal }),
    enabled: !!sessionId,
    staleTime: Infinity,
    // Poll the tiny pending-task endpoint while a task is in flight. WS is
    // the primary refresh path but can go silent on mobile networks without
    // firing onclose; the poll is the independent fallback that unsticks the
    // "Thinking" pill and the missing final reply.
    refetchInterval: pendingTaskPollMs,
  });

export const taskMessagesOptions = (taskId: string | null | undefined) =>
  queryOptions({
    queryKey: chatKeys.taskMessages(taskId ?? ""),
    queryFn: ({ signal }) => api.listTaskMessages(taskId!, { signal }),
    enabled: isTaskMessageTaskId(taskId),
    staleTime: Infinity,
  });

/**
 * Aggregate of in-flight chat tasks for the current user in this workspace —
 * drives the IM session list's "typing…" indicator row-by-row. Mirrors web's
 * `pendingChatTasksOptions` in packages/core/chat/queries.ts (list is keyed
 * on wsId; refetched via WS invalidation on task lifecycle events).
 */
export const pendingChatTasksOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: chatKeys.pendingTasks(wsId),
    queryFn: ({ signal }) => api.listPendingChatTasks({ signal }),
    enabled: !!wsId,
    staleTime: Infinity,
  });
