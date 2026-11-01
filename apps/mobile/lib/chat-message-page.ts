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
 *
 * A row the window already holds is NOT automatically "nothing new". Two
 * server writes can land behind one message id: the message row itself, then
 * a follow-up that binds its attachments (`LinkAttachmentsToChatMessage`,
 * server/internal/service/task.go). The optimistic send plus the `chat:message`
 * echo put the row in the cache before the second commit, so the cached copy
 * has no `attachments` — and discarding the refetch leaves it that way for the
 * life of the cache (`staleTime: Infinity`). That is MYS-2534: an image sent
 * from chat reached the agent but never appeared in the bubble. Known rows are
 * therefore refreshed in place, keeping the reference when nothing actually
 * changed so an unrelated refetch still doesn't re-render every bubble.
 */
export function mergeNewestMessages(
  prev: ChatMessage[],
  page: ChatMessage[],
): ChatMessage[] {
  if (page.length === 0) return prev;
  const byId = new Map(prev.map((message) => [message.id, message]));
  const fresh: ChatMessage[] = [];
  const refreshed: ChatMessage[] = [];
  for (const incoming of page) {
    const cached = byId.get(incoming.id);
    if (!cached) {
      fresh.push(incoming);
      continue;
    }
    const next = refreshKnownMessage(cached, incoming);
    if (next !== cached) refreshed.push(next);
  }
  if (fresh.length === 0 && refreshed.length === 0) return prev;
  if (fresh.length === 0) {
    // Only in-place refreshes: keep the existing order and splice replacements
    // rather than re-sorting a list that is already correctly ordered.
    const replacements = new Map(refreshed.map((message) => [message.id, message]));
    return prev.map((message) => replacements.get(message.id) ?? message);
  }
  const merged = new Map(byId);
  for (const message of refreshed) merged.set(message.id, message);
  for (const message of fresh) merged.set(message.id, message);
  return [...merged.values()].sort(compareMessages);
}

/**
 * Field-by-field refresh of a row the cache already holds.
 *
 * Direction matters per field, and it is not "the server always wins":
 *
 *   - `attachments` is server-authoritative and, unlike every other field,
 *     routinely arrives LATE (the bind is a second transaction). A server
 *     answer always replaces the cached list, including an explicit `[]`
 *     (the last attachment was removed).
 *   - Everything else can be written by the client first — the optimistic
 *     send stamps ids, `chat:done` stamps `elapsed_ms` / `message_kind`, the
 *     quick-actions pass stamps `quick_actions`. Those survive a refetch that
 *     predates them, so a field the page omits falls back to the cached value.
 *
 * Returns the SAME object when no field moved, which is what lets the caller
 * detect "nothing changed" without a deep compare.
 */
function refreshKnownMessage(
  cached: ChatMessage,
  incoming: ChatMessage,
): ChatMessage {
  const attachments = incoming.attachments ?? cached.attachments;
  const merged: ChatMessage = {
    ...cached,
    ...incoming,
    // Restate after the spread: `incoming` may carry `attachments: undefined`,
    // and an explicit key with an undefined value would still clobber the
    // cached list.
    attachments,
  };
  return sameMessage(cached, merged) ? cached : merged;
}

/** Shallow field comparison for the row shapes `ChatMessage` actually uses.
 *  `attachments` is compared by identity first (the common case: the same
 *  array the server just handed back is the one already cached) and then by
 *  its members' ids, so a re-fetched-but-identical list doesn't churn. */
function sameMessage(a: ChatMessage, b: ChatMessage): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (key === "attachments") continue;
    const av = (a as unknown as Record<string, unknown>)[key];
    const bv = (b as unknown as Record<string, unknown>)[key];
    if (av !== bv) return false;
  }
  return sameAttachments(a.attachments, b.attachments);
}

function sameAttachments(
  a: ChatMessage["attachments"],
  b: ChatMessage["attachments"],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((attachment, i) => attachment.id === b[i].id);
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
