/**
 * Query-key and cache-shape tests for the archived view's paged read path.
 *
 * Two mutations this file is built to catch, both silent in a browser:
 *
 *   - **Filters not normalized into the key.** Selecting urgent then high and
 *     high then urgent are one selection; if they key differently the cache
 *     misses and the list refetches for an identical answer.
 *   - **The cursor chain surviving a filter change.** `initialPageParam` is
 *     null, so a changed filter starts at page one. If the key did NOT include
 *     the filters, React Query would keep the fetched pages and ask for the
 *     next cursor of the OLD result set — page 2 of a list whose page 1 was
 *     never fetched, skipping rows and then reporting the end of an archive
 *     the user has not seen.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { QueryFunctionContext } from "@tanstack/react-query";
import type { ArchivedInboxPage, InboxItem } from "@multica/core/types";

const { mockListArchivedInboxPage, mockGetArchivedInboxFacets } = vi.hoisted(() => ({
  mockListArchivedInboxPage: vi.fn(),
  mockGetArchivedInboxFacets: vi.fn(),
}));

vi.mock("@/data/api", () => ({
  api: {
    listArchivedInboxPage: mockListArchivedInboxPage,
    getArchivedInboxFacets: mockGetArchivedInboxFacets,
    listArchivedInbox: vi.fn(),
    listInbox: vi.fn(),
  },
}));

import {
  archivedInboxFacetsOptions,
  archivedInboxPagesOptions,
  inboxKeys,
  mapArchivedInboxCache,
  patchArchivedInboxCaches,
} from "./inbox";
import { EMPTY_INBOX_FILTERS, type InboxFilters } from "@/lib/inbox-filters";

function row(id: string, overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id,
    workspace_id: "ws-1",
    recipient_type: "member",
    recipient_id: "m1",
    actor_type: "agent",
    actor_id: "a1",
    type: "new_comment",
    severity: "info",
    issue_id: `issue-${id}`,
    title: "t",
    body: null,
    issue_status: "done",
    issue_priority: "high",
    read: true,
    archived: true,
    created_at: "2026-08-01T00:00:00Z",
    details: null,
    ...overrides,
  };
}

function filters(overrides: Partial<InboxFilters> = {}): InboxFilters {
  return { ...EMPTY_INBOX_FILTERS, ...overrides };
}

function page(items: InboxItem[], nextCursor: string | null): ArchivedInboxPage {
  return { items, nextCursor, hasMore: nextCursor !== null };
}

/**
 * Call an infinite query's `getNextPageParam`. React Query's signature takes
 * (lastPage, allPages, lastPageParam, allPageParams); only the first matters
 * here, so the rest are filled with the shapes a real call would pass.
 */
function getNextPageParam(
  opts: {
    getNextPageParam?: (
      lastPage: ArchivedInboxPage,
      allPages: ArchivedInboxPage[],
      lastPageParam: string | null,
      allPageParams: (string | null)[],
    ) => string | null | undefined;
  },
  lastPage: ArchivedInboxPage,
): string | null | undefined {
  return opts.getNextPageParam?.(lastPage, [lastPage], null, [null]);
}

beforeEach(() => {
  mockListArchivedInboxPage.mockReset();
  mockGetArchivedInboxFacets.mockReset();
});

describe("archived inbox key factory", () => {
  it("nests the paged archive under the archived prefix", () => {
    // Under `archived`, not beside it: anything invalidating the archive by
    // prefix has to reach the pages, and the cache patchers find them that way.
    expect(inboxKeys.pages("ws-1")).toEqual(["inbox", "ws-1", "archived", "pages"]);
    expect(inboxKeys.pages("ws-1").slice(0, 3)).toEqual(inboxKeys.archived("ws-1"));
  });

  it("keeps facets a sibling of the list, not under archived", () => {
    // The counts describe the archive as a whole; dropping the page cache must
    // not drop the menu's numbers, so they do not share a prefix below the
    // workspace root.
    expect(inboxKeys.archivedFacets("ws-1")).toEqual([
      "inbox",
      "ws-1",
      "archived-facets",
    ]);
    expect(inboxKeys.archivedFacets("ws-1").slice(0, 3)).not.toEqual(
      inboxKeys.archived("ws-1"),
    );
  });

  it("scopes both by workspace", () => {
    expect(inboxKeys.pages("ws-1")).not.toEqual(inboxKeys.pages("ws-2"));
    expect(inboxKeys.archivedFacets("ws-1")).not.toEqual(
      inboxKeys.archivedFacets("ws-2"),
    );
  });
});

describe("archivedInboxPagesOptions", () => {
  it("starts at page one and derives the next param from the server's cursor", async () => {
    const opts = archivedInboxPagesOptions("ws-1", EMPTY_INBOX_FILTERS);
    expect(opts.initialPageParam).toBeNull();
    // The cursor is opaque and server-minted — handed back verbatim, never
    // constructed from anything the client knows.
    expect(getNextPageParam(opts, page([row("a")], "cur-2"))).toBe(
      "cur-2",
    );
    // End of archive → no next param, so `fetchNextPage` stops.
    expect(getNextPageParam(opts, page([row("a")], null))).toBeUndefined();
  });

  it("does not auto-retry a failed page", () => {
    // The endpoint fails loudly on drift; a silent retry would hide a real
    // truncation behind a spinner, and the list offers its own retry.
    expect(archivedInboxPagesOptions("ws-1", EMPTY_INBOX_FILTERS).retry).toBe(false);
  });

  it("is disabled without a workspace", () => {
    expect(archivedInboxPagesOptions(null, EMPTY_INBOX_FILTERS).enabled).toBe(false);
  });

  it("passes the filter selection through to the api with the page's cursor", async () => {
    const signal = new AbortController().signal;
    mockListArchivedInboxPage.mockResolvedValue(page([row("a")], null));
    const f = filters({ statuses: ["done"] });
    const options = archivedInboxPagesOptions("ws-1", f);

    const ctx = {
      client: new QueryClient(),
      queryKey: options.queryKey,
      signal,
      meta: undefined,
      pageParam: "cur-2",
    } as unknown as QueryFunctionContext;
    await options.queryFn?.(ctx as never);

    expect(mockListArchivedInboxPage).toHaveBeenCalledWith(f, {
      cursor: "cur-2",
      signal,
    });
  });
});

describe("archivedInboxPagesOptions keying", () => {
  it("gives one selection ONE key regardless of the order its values were picked", () => {
    // The refetch-on-a-second-checkbox defect: without normalization these are
    // two keys over identical results.
    const a = archivedInboxPagesOptions("ws-1", filters({ priorities: ["urgent", "high"] }));
    const b = archivedInboxPagesOptions("ws-1", filters({ priorities: ["high", "urgent"] }));
    expect(a.queryKey).toEqual(b.queryKey);
  });

  it("changes the key when a filter changes, so the cursor chain cannot leak across", () => {
    // The load-bearing one. A shared key would keep the fetched pages and ask
    // for the next cursor of the old result set. This asserts the difference,
    // which is what makes React Query discard the old pages and start at null.
    const base = archivedInboxPagesOptions("ws-1", EMPTY_INBOX_FILTERS);
    const narrowed = archivedInboxPagesOptions("ws-1", filters({ statuses: ["done"] }));
    const unread = archivedInboxPagesOptions("ws-1", filters({ unreadOnly: true }));
    const otherWs = archivedInboxPagesOptions("ws-2", EMPTY_INBOX_FILTERS);

    expect(narrowed.queryKey).not.toEqual(base.queryKey);
    expect(unread.queryKey).not.toEqual(base.queryKey);
    expect(unread.queryKey).not.toEqual(narrowed.queryKey);
    expect(otherWs.queryKey).not.toEqual(base.queryKey);
  });

  it("distinguishes dimensions that hold the same number of values", () => {
    // A key built from the counts or a joined string without labels would
    // collide here: one status and one priority both "1 value".
    const byStatus = archivedInboxPagesOptions("ws-1", filters({ statuses: ["done"] }));
    const byPriority = archivedInboxPagesOptions(
      "ws-1",
      filters({ priorities: ["done" as never] }),
    );
    expect(byStatus.queryKey).not.toEqual(byPriority.queryKey);
  });
});

describe("archivedInboxFacetsOptions", () => {
  it("keys by the filters it counts for", () => {
    const base = archivedInboxFacetsOptions("ws-1", EMPTY_INBOX_FILTERS);
    const narrowed = archivedInboxFacetsOptions("ws-1", filters({ statuses: ["done"] }));

    expect(base.queryKey[0]).toBe("inbox");
    expect(narrowed.queryKey).not.toEqual(base.queryKey);
    // Same normalization as the pages, so the counts and the rows they describe
    // can never be keyed differently for one selection.
    expect(
      archivedInboxFacetsOptions("ws-1", filters({ actors: ["b", "a"] })).queryKey,
    ).toEqual(archivedInboxFacetsOptions("ws-1", filters({ actors: ["a", "b"] })).queryKey);
  });

  it("does not auto-retry", () => {
    expect(archivedInboxFacetsOptions("ws-1", EMPTY_INBOX_FILTERS).retry).toBe(false);
  });

  it("resolves through api.getArchivedInboxFacets", async () => {
    const signal = new AbortController().signal;
    mockGetArchivedInboxFacets.mockResolvedValue({
      statuses: {},
      priorities: {},
      actors: {},
      unreadCount: 0,
    });
    const options = archivedInboxFacetsOptions("ws-1", EMPTY_INBOX_FILTERS);

    await options.queryFn?.({
      client: new QueryClient(),
      queryKey: options.queryKey,
      signal,
      meta: undefined,
    } as never);

    expect(mockGetArchivedInboxFacets).toHaveBeenCalledWith(
      EMPTY_INBOX_FILTERS,
      { signal },
    );
  });
});

describe("mapArchivedInboxCache", () => {
  it("patches a legacy array in place", () => {
    const out = mapArchivedInboxCache([row("a"), row("b")], (items) =>
      items.filter((i) => i.id !== "a"),
    );
    expect((out as InboxItem[]).map((i) => i.id)).toEqual(["b"]);
  });

  it("patches every page of an infinite cache", () => {
    const data = {
      pages: [page([row("a")], "c2"), page([row("b")], null)],
      pageParams: [null, "c2"],
    };
    const out = mapArchivedInboxCache(data, (items) =>
      items.map((i) => ({ ...i, read: false })),
    ) as typeof data;

    expect(out.pages.every((p) => p.items.every((i) => i.read === false))).toBe(true);
  });

  it("preserves pageParams, cursors and hasMore — only items change", () => {
    // pageParams indexes the cursor chain; rewriting it would break every
    // subsequent fetchNextPage.
    const data = {
      pages: [page([row("a")], "c2")],
      pageParams: [null],
    };
    const out = mapArchivedInboxCache(data, (items) =>
      items.map((i) => ({ ...i, read: false })),
    ) as typeof data;

    expect(out.pageParams).toEqual([null]);
    expect(out.pages[0]?.nextCursor).toBe("c2");
    expect(out.pages[0]?.hasMore).toBe(true);
  });

  it("treats an undefined patch result as 'nothing to change'", () => {
    // The shared patch helpers return undefined for an absent list so they can
    // serve both callers; here the list is known present, so the rows must
    // survive rather than the page being emptied.
    const items = [row("a")];
    const out = mapArchivedInboxCache(items, () => undefined) as InboxItem[];
    expect(out).toEqual(items);
  });
});

describe("patchArchivedInboxCaches", () => {
  it("reaches the pages cached under EVERY filter selection, not just one", () => {
    // An unarchive has to clear the row from the archive whichever filter the
    // user was reading, and from the ones they can toggle back to.
    const qc = new QueryClient();
    const base = archivedInboxPagesOptions("ws-1", EMPTY_INBOX_FILTERS).queryKey;
    const narrowed = archivedInboxPagesOptions("ws-1", filters({ statuses: ["done"] }))
      .queryKey;
    qc.setQueryData(base, { pages: [page([row("a")], null)], pageParams: [null] });
    qc.setQueryData(narrowed, { pages: [page([row("a")], null)], pageParams: [null] });

    patchArchivedInboxCaches(qc, "ws-1", (items) =>
      items.map((i) => ({ ...i, archived: false })),
    );

    for (const key of [base, narrowed]) {
      const data = qc.getQueryData<{ pages: ArchivedInboxPage[] }>(key);
      expect(data?.pages[0]?.items[0]?.archived).toBe(false);
    }
  });

  it("does not touch another workspace's archive", () => {
    const qc = new QueryClient();
    const mine = archivedInboxPagesOptions("ws-1", EMPTY_INBOX_FILTERS).queryKey;
    const theirs = archivedInboxPagesOptions("ws-2", EMPTY_INBOX_FILTERS).queryKey;
    qc.setQueryData(mine, { pages: [page([row("a")], null)], pageParams: [null] });
    qc.setQueryData(theirs, { pages: [page([row("b")], null)], pageParams: [null] });

    patchArchivedInboxCaches(qc, "ws-1", (items) =>
      items.map((i) => ({ ...i, archived: false })),
    );

    const other = qc.getQueryData<{ pages: ArchivedInboxPage[] }>(theirs);
    expect(other?.pages[0]?.items[0]?.archived).toBe(true);
  });

  it("returns a snapshot that restores the pre-patch state", () => {
    // The rollback path for a failed unarchive.
    const qc = new QueryClient();
    const key = archivedInboxPagesOptions("ws-1", EMPTY_INBOX_FILTERS).queryKey;
    const before = { pages: [page([row("a")], null)], pageParams: [null] };
    qc.setQueryData(key, before);

    const snapshot = patchArchivedInboxCaches(qc, "ws-1", (items) =>
      items.map((i) => ({ ...i, archived: false })),
    );
    for (const [snapKey, data] of snapshot) qc.setQueryData(snapKey, data);

    expect(qc.getQueryData(key)).toEqual(before);
  });

  it("skips entries with no data, so it does not fabricate a cache entry", () => {
    const qc = new QueryClient();
    const key = archivedInboxPagesOptions("ws-1", EMPTY_INBOX_FILTERS).queryKey;
    // Register the query with no data, as an un-run query would be.
    qc.getQueryCache().build(qc, { queryKey: key, queryFn: async () => undefined });

    patchArchivedInboxCaches(qc, "ws-1", (items) =>
      items.map((i) => ({ ...i, archived: false })),
    );

    expect(qc.getQueryData(key)).toBeUndefined();
  });
});
