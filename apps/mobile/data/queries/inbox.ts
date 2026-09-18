import { queryOptions, type UseQueryOptions } from "@tanstack/react-query";
import type { InboxItem } from "@multica/core/types";
import { api } from "@/data/api";

/** The two inbox lists a single notification can live in. */
export type InboxBucket = "inbox" | "archived";

/**
 * Inbox cache key factory.
 *
 * Shape mirrors web's `packages/core/inbox/queries.ts` — `["inbox", wsId, "list"]`
 * — so cross-platform mental model stays the same. Keying on wsId means
 * workspace switches naturally invalidate (TQ sees a new key and refetches).
 */
export const inboxKeys = {
  all: (wsId: string | null) => ["inbox", wsId] as const,
  list: (wsId: string | null) =>
    [...inboxKeys.all(wsId), "list"] as const,
  archived: (wsId: string | null) =>
    [...inboxKeys.all(wsId), "archived"] as const,
  /**
   * Account-level (NOT workspace-scoped): one shared cache entry holding
   * unread counts for every workspace the user belongs to. Same key web uses
   * (`["inbox", "unread-summary"]`). A workspace-scoped key here would
   * refetch identical account data on every switch, and would lose the whole
   * point of the entry — reporting on workspaces you are NOT currently in.
   */
  unreadSummary: () => ["inbox", "unread-summary"] as const,
};

export const inboxListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: inboxKeys.list(wsId),
    queryFn: ({ signal }) => api.listInbox({ signal }),
    enabled: !!wsId,
  });

/**
 * Cross-workspace unread inbox summary. One cache entry shared across all
 * workspaces — the data is account-level, so switching workspaces does not
 * refetch it; only the derived "is this for another workspace" view changes.
 *
 * Deliberately carries no `enabled`: callers gate it themselves. The screens
 * that render it (workspace switcher, More popover) only mount inside a
 * workspace, so they pass `enabled: !!wsId` the way web's sidebar does —
 * mirroring web's `inboxUnreadSummaryOptions` (packages/core/inbox/queries.ts:40).
 */
export const inboxUnreadSummaryOptions = () =>
  queryOptions({
    queryKey: inboxKeys.unreadSummary(),
    queryFn: ({ signal }) => api.getInboxUnreadSummary({ signal }),
  });

/**
 * Archived notifications, backing the inbox's "Archived" sub-view. A separate
 * cache entry from the main list rather than one flat cache split locally: the
 * archive grows without end, so it is fetched from its own capped endpoint,
 * and the server — not the client — decides which issues belong in which list.
 * Mirrors web's archivedInboxListOptions (packages/core/inbox/queries.ts);
 * the two keys are invalidated together by every archive-mutating mutation.
 */
export const archivedInboxListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: inboxKeys.archived(wsId),
    queryFn: ({ signal }) => api.listArchivedInbox({ signal }),
    enabled: !!wsId,
  });

/**
 * The same two lists behind one signature, for callers that pick the bucket at
 * runtime — the inbox-item detail screen, which reads whichever list the deep
 * link's `view` names. The cache keys are unchanged (`list` / `archived`), so
 * the tab, this screen and the archive mutations keep sharing one cache entry
 * per list.
 *
 * The return type is spelled out because the two `queryOptions` above carry
 * different literal query keys: a caller that branches between them would get a
 * union TypeScript cannot pass to `useQuery`, since `QueryFunction` is
 * contravariant in the key.
 */
export function inboxBucketOptions(
  bucket: InboxBucket,
  wsId: string | null,
): UseQueryOptions<
  InboxItem[],
  Error,
  InboxItem[],
  readonly ["inbox", string | null, "list" | "archived"]
> {
  const archived = bucket === "archived";
  return {
    queryKey: archived ? inboxKeys.archived(wsId) : inboxKeys.list(wsId),
    queryFn: ({ signal }) =>
      archived ? api.listArchivedInbox({ signal }) : api.listInbox({ signal }),
    enabled: !!wsId,
  };
}
