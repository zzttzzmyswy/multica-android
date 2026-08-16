import type { ChatPendingTask } from "@multica/core/types";

/**
 * Poll cadence for the in-flight chat task while it is active.
 *
 * The chat domain caches everything at `staleTime: Infinity` and relies on
 * WS events as the only refresh path. On mobile networks a socket can go
 * silent without firing `onclose` (NAT half-open), or a reconnect-time
 * invalidation refetch can fail — and a stale cache never self-heals. The
 * visible result is the "stuck on Thinking" bug: the server already finished
 * the turn, but the pill stays up and the reply never renders until the user
 * sends another message (which invalidates pendingTask + messages). Polling
 * just the tiny pending-task endpoint while a task is in flight closes the
 * gap without re-polling the whole message list.
 */
export const CHAT_TASK_POLL_INTERVAL_MS = 4_000;

export function isPendingTaskActive(
  task: ChatPendingTask | null | undefined,
): boolean {
  return typeof task?.task_id === "string" && task.task_id.length > 0;
}

/** `refetchInterval` for pendingChatTaskOptions — active task → poll, idle → off. */
export function pendingTaskPollMs(query: {
  state: { data?: unknown };
}): number | false {
  return isPendingTaskActive(query.state.data as ChatPendingTask | null | undefined)
    ? CHAT_TASK_POLL_INTERVAL_MS
    : false;
}

/**
 * True only on the in-flight → idle edge. Owners use this to invalidate
 * child caches (the authoritative messages list) that a missing terminal
 * WS event would otherwise leave stale forever.
 */
export function didPendingTaskFinish(
  prev: ChatPendingTask | null | undefined,
  next: ChatPendingTask | null | undefined,
): boolean {
  return isPendingTaskActive(prev) && !isPendingTaskActive(next);
}