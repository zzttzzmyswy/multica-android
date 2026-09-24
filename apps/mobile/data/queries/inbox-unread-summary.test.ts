/**
 * Cross-workspace unread summary — mobile query layer.
 *
 * Mirrors web's `inboxKeys.unreadSummary` / `inboxUnreadSummaryOptions`
 * (packages/core/inbox/queries.ts:11,40): ONE account-level cache entry shared
 * by every workspace, because the endpoint reports on all of them at once.
 * Keying it per-workspace would refetch identical data on every switch.
 *
 * The two derivations (`hasOtherWorkspaceUnread` / `unreadWorkspaceIds`) are
 * imported from `@multica/core/inbox/unread-summary` rather than reimplemented
 * here — a mobile-local copy would drift from the web one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const { mockGetInboxUnreadSummary } = vi.hoisted(() => ({
  mockGetInboxUnreadSummary: vi.fn(),
}));

vi.mock("@/data/api", () => ({
  api: { getInboxUnreadSummary: mockGetInboxUnreadSummary },
}));

import { inboxKeys, inboxUnreadSummaryOptions } from "./inbox";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("inboxKeys.unreadSummary", () => {
  it("is the account-level key web uses", () => {
    expect(inboxKeys.unreadSummary()).toEqual(["inbox", "unread-summary"]);
  });

  it("is a flat account key — no workspace id can be spliced into it", () => {
    // Length is the load-bearing part. A per-workspace spelling such as
    // ["inbox", wsId, "unread-summary"] would key account data by whichever
    // workspace the user happens to be standing in: identical data refetched
    // on every switch, and the entries for other workspaces hidden behind the
    // active one.
    expect(inboxKeys.unreadSummary()).toHaveLength(2);
    expect(inboxKeys.unreadSummary()).not.toEqual(inboxKeys.all("ws-1"));
    expect(inboxKeys.unreadSummary()).not.toEqual(inboxKeys.list("ws-1"));
    expect(inboxKeys.unreadSummary()).not.toEqual(inboxKeys.archived("ws-1"));
  });

  it("does not collide with a workspace-scoped list key", () => {
    expect(inboxKeys.unreadSummary()).not.toEqual(inboxKeys.all("ws-1"));
    expect(inboxKeys.unreadSummary()).not.toEqual(inboxKeys.archived("ws-1"));
  });
});

describe("inboxUnreadSummaryOptions", () => {
  it("fetches through the mobile api method with the forwarded signal", async () => {
    mockGetInboxUnreadSummary.mockResolvedValue([{ workspace_id: "ws-2", count: 3 }]);
    const opts = inboxUnreadSummaryOptions();
    const controller = new AbortController();

    const data = await opts.queryFn!({
      client: new QueryClient(),
      queryKey: opts.queryKey,
      signal: controller.signal,
      meta: undefined,
    });

    expect(mockGetInboxUnreadSummary).toHaveBeenCalledWith({
      signal: controller.signal,
    });
    expect(data).toEqual([{ workspace_id: "ws-2", count: 3 }]);
  });

  it("caches under the account-level key, so a workspace switch is a cache hit", async () => {
    mockGetInboxUnreadSummary.mockResolvedValue([{ workspace_id: "ws-2", count: 3 }]);
    const qc = new QueryClient();
    const opts = inboxUnreadSummaryOptions();

    await qc.fetchQuery(opts);
    expect(mockGetInboxUnreadSummary).toHaveBeenCalledTimes(1);

    // Same key regardless of which workspace the caller is standing in.
    expect(qc.getQueryData(inboxKeys.unreadSummary())).toEqual([
      { workspace_id: "ws-2", count: 3 },
    ]);
  });

  it("is not gated on a workspace — the caller decides via enabled", () => {
    expect(inboxUnreadSummaryOptions()).not.toHaveProperty("enabled");
  });
});
