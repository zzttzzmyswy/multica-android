/**
 * Pure helpers behind chat history pagination.
 *
 * The mobile cache contract stays what it has always been —
 * `chatKeys.messages(sessionId)` is a FLAT `ChatMessage[]` in ascending
 * order, which is what the WS appenders, the optimistic send path and
 * `hideQueuedChatMessages` all assume. Paging therefore does not become a
 * second cache shape (web uses `useInfiniteQuery` and can afford pages);
 * it is a cursor kept alongside, plus a prepend. These functions are the
 * whole of that logic, so they are pinned by unit tests rather than
 * exercised only through the screen.
 *
 * Mirrors the semantics of web's `chatMessagesPageOptions`
 * (`packages/core/chat/queries.ts:144-155`): `getNextPageParam` yields a
 * cursor only when the page both says `has_more` AND carries one. A page
 * that claims more but hands back no cursor is un-followable — treating it
 * as "more" would spin the loading row forever on a request that can never
 * advance.
 */
import type { ChatMessage } from "@multica/core/types";
import type { ChatMessagesCursor, ChatMessagesPage } from "@/data/schemas";

export interface ChatMessagesPageState {
  hasMore: boolean;
  cursor: ChatMessagesCursor | null;
}

/**
 * Ascending by `created_at`, ties broken by `id`.
 *
 * The server paginates on the `(created_at, id)` tuple, so a timestamp tie is
 * a real ordering case — a user message and the assistant row it triggered can
 * share a millisecond. Sorting on `created_at` alone would leave ties in
 * insertion order, which differs between a fetched page and a prepended one,
 * so the list would reshuffle as history loads.
 */
function compareMessages(a: ChatMessage, b: ChatMessage): number {
  const at = Date.parse(a.created_at);
  const bt = Date.parse(b.created_at);
  if (at !== bt) return at - bt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export const EMPTY_CHAT_MESSAGES_PAGE_STATE: ChatMessagesPageState = {
  hasMore: false,
  cursor: null,
};

/** Derive the follow-up cursor state from one server page. `next_cursor` is
 *  optional on the wire (the server omits it entirely when there is nothing
 *  older), so accept `undefined` as "no cursor" alongside `null`. */
export function pageStateFrom(page: {
  has_more: boolean;
  next_cursor?: ChatMessagesCursor | null;
}): ChatMessagesPageState {
  return {
    hasMore: page.has_more && page.next_cursor != null,
    cursor: page.next_cursor ?? null,
  };
}

/**
 * Prepend an older page to the live window.
 *
 * Dedupes by id: the cursor is `(created_at, id)` and a message created in
 * the same instant as the window's head can land in both pages. Returns the
 * SAME array reference when nothing new arrived, so a redundant load doesn't
 * re-render every bubble through `ChatMessageList`'s memo.
 *
 * No re-sorting: the server returns each page in ascending order and the
 * cursor guarantees the older page ends before the current window begins.
 * Sorting here would mean parsing timestamps on every load and would paper
 * over a server ordering bug instead of surfacing it.
 */
export function mergeOlderMessages(
  prev: ChatMessage[],
  older: ChatMessage[],
): ChatMessage[] {
  if (older.length === 0) return prev;
  const known = new Set(prev.map((message) => message.id));
  const fresh = older.filter((message) => !known.has(message.id));
  if (fresh.length === 0) return prev;
  return [...fresh, ...prev];
}

/**
 * Merge a freshly-fetched NEWEST page into the live window.
 *
 * Once history has been paged in, a plain replace would throw it away: the
 * newest page is always fetched with no cursor, so it only ever carries the
 * tail. The chat screen re-fetches this query when a turn finishes
 * (`didPendingTaskFinish`), which is exactly when a reader may already be
 * deep in scrollback — without this merge, every completed turn would snap
 * the window back to the last 50 messages.
 *
 * Dedupes by id (a page can repeat rows the window already holds) and
 * re-sorts, because the two sets are no longer contiguous.
 */
export function mergeNewestMessages(
  prev: ChatMessage[],
  page: ChatMessage[],
): ChatMessage[] {
  if (page.length === 0) return prev;
  const known = new Set(prev.map((message) => message.id));
  const fresh = page.filter((message) => !known.has(message.id));
  if (fresh.length === 0) return prev;
  return [...prev, ...fresh].sort(compareMessages);
}

/**
 * Does this session have an in-flight task?
 *
 * The session list swaps its "archive" row action for "stop" on this signal
 * (`packages/views/chat/components/chat-thread-list.tsx:301-311`), so it has
 * to read the same aggregate the "typing…" indicator does — one source, or a
 * row could show "typing…" while offering "archive".
 */
export function isSessionRunning(
  pendingTasks: { chat_session_id: string }[] | undefined,
  sessionId: string,
): boolean {
  if (!pendingTasks) return false;
  return pendingTasks.some((task) => task.chat_session_id === sessionId);
}
