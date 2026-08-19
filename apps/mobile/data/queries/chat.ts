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
import { queryOptions } from "@tanstack/react-query";
import type { ChatSession } from "@multica/core/types";
import { api } from "@/data/api";
import { pendingTaskPollMs } from "@/lib/chat-task-polling";

export const chatKeys = {
  all: (wsId: string | null) => ["chat", wsId] as const,
  sessions: (wsId: string | null) =>
    [...chatKeys.all(wsId), "sessions"] as const,
  messages: (sessionId: string) => ["chat", "messages", sessionId] as const,
  pendingTask: (sessionId: string) =>
    ["chat", "pending-task", sessionId] as const,
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
function sessionActivityTime(s: ChatSession): number {
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
    queryFn: ({ signal }) => api.listChatMessages(sessionId!, { signal }),
    enabled: !!sessionId,
    staleTime: Infinity,
  });

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
