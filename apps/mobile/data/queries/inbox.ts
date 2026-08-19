import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

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
};

export const inboxListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: inboxKeys.list(wsId),
    queryFn: ({ signal }) => api.listInbox({ signal }),
    enabled: !!wsId,
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
