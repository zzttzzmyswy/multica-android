import {
  infiniteQueryOptions,
  queryOptions,
  type InfiniteData,
  type QueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { ArchivedInboxPage, InboxItem } from "@multica/core/types";
import { api } from "@/data/api";
import {
  normalizeInboxFilters,
  type ArchivedInboxFilters,
  type InboxFilters,
} from "@/lib/inbox-filters";

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
   * The paged archive. A child of `archived` rather than a sibling — the key
   * shape web uses (`[...archived(wsId), "pages"]`) — so anything that
   * invalidates the whole archive by prefix still reaches it. Every
   * archive-mutating mutation invalidates `inboxKeys.all(wsId)`, which
   * covers this; the nesting is what lets the cache patchers below find these
   * entries by prefix when they need to patch rather than refetch.
   */
  pages: (wsId: string | null) =>
    [...inboxKeys.archived(wsId), "pages"] as const,
  /**
   * Facet counts. Under `all` rather than under `archived` — again web's
   * shape — because the counts describe the archive as a whole and survive
   * a page-cache reset: dropping `pages` must not drop the menu's numbers.
   */
  archivedFacets: (wsId: string | null) =>
    [...inboxKeys.all(wsId), "archived-facets"] as const,
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
 * archive grows without end, so the server — not the client — decides which
 * issues belong in which list.
 *
 * Capped at the server's `LIMIT`, so this is no longer the archive view's read
 * path — `archivedInboxPagesOptions` is. It is kept as the single-page read for
 * consumers that want "the newest slice" rather than "all of it", and because
 * the two keys are invalidated together by every archive-mutating mutation.
 */
export const archivedInboxListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: inboxKeys.archived(wsId),
    queryFn: ({ signal }) => api.listArchivedInbox({ signal }),
    enabled: !!wsId,
  });

/**
 * The archive view's read path: an infinite query over the cursor-paged
 * endpoint, keyed by the filter selection.
 *
 * The filters are part of the key (`normalizedInboxFilters`, sorted) so a
 * changed selection is a different query rather than a stale page list
 * refetched in place. Two things follow, and both are the point:
 *
 *   - Every filter change starts at page one. Reusing the cursor chain across
 *     a filter change would ask for page 2 of a result set whose page 1 was
 *     never fetched — skipping rows and, once the pages run out, reporting the
 *     end of an archive the user has not seen.
 *   - Returning to a previous selection is instant, because its pages are
 *     still cached under its own key.
 *
 * `retry: false` matches web: this endpoint fails loudly (see
 * `listArchivedInboxPage`), and a silent auto-retry would hide a real
 * truncation behind a spinner. The list offers its own retry.
 */
export const archivedInboxPagesOptions = (
  wsId: string | null,
  filters: ArchivedInboxFilters,
) =>
  infiniteQueryOptions({
    queryKey: [...inboxKeys.pages(wsId), normalizeInboxFilters(filters)],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.listArchivedInboxPage(filters, { cursor: pageParam, signal }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!wsId,
    retry: false,
  });

/**
 * Facet counts for the filter menu, over the current selection. Same key
 * discipline as the pages: the counts depend on which filters are active, so
 * they are keyed by them and refetched when they change — that is what makes
 * each number agree with the list it is offered beside.
 */
export const archivedInboxFacetsOptions = (
  wsId: string | null,
  filters: ArchivedInboxFilters,
) =>
  queryOptions({
    queryKey: [...inboxKeys.archivedFacets(wsId), normalizeInboxFilters(filters)],
    queryFn: ({ signal }) => api.getArchivedInboxFacets(filters, { signal }),
    enabled: !!wsId,
    retry: false,
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

/**
 * Whatever the archived sub-view's caches hold: the paged infinite list, or
 * the legacy single-page array. Both live under `inboxKeys.archived(wsId)`,
 * and both have to answer the same patches — an optimistic unarchive that
 * only reached one of them would leave the other showing the row the user
 * just acted on.
 */
export type ArchivedInboxCache =
  | InboxItem[]
  | InfiniteData<ArchivedInboxPage>;

/**
 * Apply `patch` to archived cache data, whichever shape it is in.
 *
 * The `"pages" in data` test is the discriminator, and it is sound because
 * the two shapes are structurally disjoint: an array is not an object with a
 * `pages` key, and `InfiniteData` always has one. `pageParams` is carried
 * through untouched — it indexes the cursor chain, so rewriting it would
 * break `fetchNextPage` for every subsequent page.
 *
 * The patch's `| undefined` return is honoured rather than asserted away: the
 * shared patch helpers (`unarchiveInboxPatch` and friends) are typed over a
 * possibly-absent list and return `undefined` to mean "nothing to patch".
 * They can never see one here — the caller skips entries with no data — so
 * `?? items` is the correct reading of that type rather than a guard.
 */
export function mapArchivedInboxCache(
  data: ArchivedInboxCache,
  patch: (items: InboxItem[]) => InboxItem[] | undefined,
): ArchivedInboxCache {
  const apply = (items: InboxItem[]) => patch(items) ?? items;
  if (Array.isArray(data)) return apply(data);
  return {
    ...data,
    pages: data.pages.map((page) => ({ ...page, items: apply(page.items) })),
  };
}

/**
 * Patch every archived cache under this workspace's prefix, returning the
 * pre-patch snapshot for rollback.
 *
 * Prefix-based rather than key-based because the paged entries are keyed by
 * filter selection: an unarchive has to reach the pages cached under
 * *every* selection the user has visited, not just the one on screen. Rows
 * carry `archived`, and the dedup helpers filter on it, so patching a page
 * whose filter would no longer include the row is harmless — the row drops
 * out on the next render either way, and the alternative (patching only the
 * visible selection) leaves stale rows behind the moment the user toggles
 * back.
 *
 * Entries with no data yet are skipped: a query registered but never
 * resolved has nothing to patch, and `setQueryData` over `undefined` would
 * fabricate a cache entry for a selection never fetched.
 */
export function patchArchivedInboxCaches(
  qc: QueryClient,
  wsId: string | null,
  patch: (items: InboxItem[]) => InboxItem[] | undefined,
): [readonly unknown[], ArchivedInboxCache | undefined][] {
  const snapshot = qc.getQueriesData<ArchivedInboxCache>({
    queryKey: inboxKeys.archived(wsId),
  });
  for (const [key, data] of snapshot) {
    if (data) qc.setQueryData(key, mapArchivedInboxCache(data, patch));
  }
  return snapshot;
}
