/**
 * API-layer tests for the archived-inbox paged surface
 * (listArchivedInboxPage / getArchivedInboxFacets).
 *
 * The URL shape is pinned here rather than left to the query layer because it
 * IS the contract with the server: `limit`, the sorted comma-joined value
 * lists, `unread_only=true`, and `cursor` only on a continuation. A silent
 * drift in any of them degrades the archive without an error — dropping
 * `cursor` re-serves page one forever, dropping a dimension widens the result
 * set the UI then reports a narrowed count for.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.EXPO_PUBLIC_API_URL = "https://api.test";

vi.mock("expo-file-system", () => ({
  File: class {
    uri = "file:///mock";
    exists = false;
  },
  Paths: { document: { uri: "file:///doc" } },
}));

vi.mock("expo-file-system/legacy", () => ({
  createDownloadResumable: vi.fn(),
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

type ApiClient = typeof import("./api").api;
let api: ApiClient;

const fetchSpy = () =>
  vi.spyOn(api as unknown as { fetch: () => Promise<unknown> }, "fetch");

beforeAll(async () => {
  ({ api } = await import("./api"));
});

beforeEach(() => {
  vi.restoreAllMocks();
});

const EMPTY = { statuses: [], priorities: [], actors: [], unreadOnly: false } as const;

function archivedRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    workspace_id: "ws-1",
    recipient_type: "member",
    recipient_id: "member-1",
    actor_type: "agent",
    actor_id: "agent-1",
    type: "status_changed",
    severity: "info",
    issue_id: "issue-1",
    title: "Archived notification",
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

function pageBody(items: unknown[], nextCursor: string | null) {
  return { items, next_cursor: nextCursor, has_more: nextCursor !== null };
}

describe("listArchivedInboxPage", () => {
  it("GETs the paged endpoint with limit=50 and no cursor on the first page", async () => {
    const spy = fetchSpy().mockResolvedValue(pageBody([archivedRow("a1")], "cur-2"));
    const page = await api.listArchivedInboxPage(EMPTY, {});

    const [path] = spy.mock.calls[0] as unknown as [string];
    expect(path.startsWith("/api/inbox/archived/page?")).toBe(true);
    expect(path).toContain("limit=50");
    // An absent cursor is the definition of "first page" — sending an empty
    // one is a different request the server rejects.
    expect(path).not.toContain("cursor=");
    expect(page.items[0]?.id).toBe("a1");
    expect(page.nextCursor).toBe("cur-2");
    expect(page.hasMore).toBe(true);
  });

  it("sends the cursor on a continuation", async () => {
    const spy = fetchSpy().mockResolvedValue(pageBody([archivedRow("a2")], null));
    await api.listArchivedInboxPage(EMPTY, { cursor: "cur-2" });

    const [path] = spy.mock.calls[0] as unknown as [string];
    expect(path).toContain("cursor=cur-2");
  });

  it("sends group_id when resolving one group directly", async () => {
    // The archive's deep-link escape hatch: the cursor chain only ever
    // describes the newest N groups, so a link into the middle of a 1,287-row
    // archive can only be resolved by asking for that group by id. The server
    // supports it (`ListArchivedInboxPage` narrows to the group and indexes
    // it), and omitting the parameter here would silently put the client back
    // on "walk every page" — which is the bug.
    const spy = fetchSpy().mockResolvedValue(pageBody([], null));
    await api.listArchivedInboxPage(EMPTY, {
      groupId: "01a1285f-bdc6-7a2f-8b9b-870ccdbeb1c3",
    });

    const [path] = spy.mock.calls[0] as unknown as [string];
    expect(path).toContain("group_id=01a1285f-bdc6-7a2f-8b9b-870ccdbeb1c3");
  });

  it("omits group_id when none is asked for, so the list stays a list", async () => {
    // An accidental empty `group_id=` is not "no filter" server-side: it is an
    // empty string that fails parseUUIDOrBadRequest as a 400.
    const spy = fetchSpy().mockResolvedValue(pageBody([], null));
    await api.listArchivedInboxPage(EMPTY, { groupId: "" });

    const [path] = spy.mock.calls[0] as unknown as [string];
    expect(path).not.toContain("group_id");
  });

  it("joins every dimension as a sorted, comma-separated list", async () => {
    const spy = fetchSpy().mockResolvedValue(pageBody([], null));
    await api.listArchivedInboxPage(
      {
        statuses: ["todo", "done"],
        priorities: ["low", "urgent"],
        actors: ["member:b", "agent:a"],
        unreadOnly: true,
      },
      {},
    );

    const [path] = spy.mock.calls[0] as unknown as [string];
    // Sorted, because the client keys its cache on what it sent: an unsorted
    // join would make one selection two cache entries depending on click order.
    expect(path).toContain(`statuses=${encodeURIComponent("done,todo")}`);
    expect(path).toContain(`priorities=${encodeURIComponent("low,urgent")}`);
    expect(path).toContain(`actors=${encodeURIComponent("agent:a,member:b")}`);
    expect(path).toContain("unread_only=true");
  });

  it("omits an unselected dimension rather than sending it empty", async () => {
    const spy = fetchSpy().mockResolvedValue(pageBody([], null));
    await api.listArchivedInboxPage(EMPTY, {});

    const [path] = spy.mock.calls[0] as unknown as [string];
    expect(path).not.toContain("statuses");
    expect(path).not.toContain("priorities");
    expect(path).not.toContain("actors");
    expect(path).not.toContain("unread_only");
  });

  it("forwards the caller's abort signal", async () => {
    const spy = fetchSpy().mockResolvedValue(pageBody([], null));
    const signal = new AbortController().signal;
    await api.listArchivedInboxPage(EMPTY, { signal });

    expect((spy.mock.calls[0] as unknown[])?.[1]).toEqual(expect.objectContaining({ signal }));
  });

  it("parses issue_priority, keeping null distinct from absent", async () => {
    fetchSpy().mockResolvedValue(
      pageBody(
        [
          archivedRow("with", { issue_priority: "urgent" }),
          archivedRow("without", { issue_priority: null }),
        ],
        null,
      ),
    );
    const page = await api.listArchivedInboxPage(EMPTY, {});

    expect(page.items[0]?.issue_priority).toBe("urgent");
    // null means the server spoke and the answer is "no priority" — the
    // capability probe depends on this staying different from `undefined`.
    expect(page.items[1]?.issue_priority).toBeNull();
  });

  it("leaves issue_priority absent when the server omits the field", async () => {
    const legacy = archivedRow("legacy");
    delete (legacy as Record<string, unknown>).issue_priority;
    fetchSpy().mockResolvedValue(pageBody([legacy], null));

    const page = await api.listArchivedInboxPage(EMPTY, {});
    expect(page.items[0]?.issue_priority).toBeUndefined();
  });

  it("THROWS on a malformed body instead of reporting an empty page", async () => {
    // The deliberate opposite of listArchivedInbox's fallback: an empty list is
    // a legitimate archive state, so silently substituting one would render
    // "nothing archived" over a full archive — the exact silent truncation
    // this endpoint replaces. Throwing routes it to the list's error state.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchSpy().mockResolvedValue({ not: "a page" });

    await expect(api.listArchivedInboxPage(EMPTY, {})).rejects.toThrow(
      "Invalid archived inbox page response",
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("THROWS on a page whose has_more and next_cursor disagree", async () => {
    // Two spells of one fact. "More" with no cursor renders a load-more that
    // can never load; a cursor under has_more:false would have the client
    // discard the rest of the archive on the server's word alone.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchSpy().mockResolvedValue({
      items: [archivedRow("a1")],
      next_cursor: null,
      has_more: true,
    });

    await expect(api.listArchivedInboxPage(EMPTY, {})).rejects.toThrow(
      "Invalid archived inbox page response",
    );
    warn.mockRestore();
  });

  it("THROWS on a non-final page that carries no rows", async () => {
    // A page claiming more while holding nothing would make the list render a
    // load-more that produces no rows — an infinite "loading" with no end.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchSpy().mockResolvedValue({ items: [], next_cursor: "cur-2", has_more: true });

    await expect(api.listArchivedInboxPage(EMPTY, {})).rejects.toThrow(
      "Invalid archived inbox page response",
    );
    warn.mockRestore();
  });

  it("accepts a final page with no rows", async () => {
    fetchSpy().mockResolvedValue({ items: [], next_cursor: null, has_more: false });
    await expect(api.listArchivedInboxPage(EMPTY, {})).resolves.toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
  });
});

describe("getArchivedInboxFacets", () => {
  it("GETs the facets endpoint and maps unread_count to unreadCount", async () => {
    const spy = fetchSpy().mockResolvedValue({
      statuses: { done: 816 },
      priorities: { high: 210 },
      actors: { "agent:a": 5, system: 1 },
      unread_count: 10,
    });
    const facets = await api.getArchivedInboxFacets(EMPTY);

    expect((spy.mock.calls[0] as unknown[])?.[0]).toBe("/api/inbox/archived/facets");
    expect(facets.unreadCount).toBe(10);
    expect(facets.statuses).toEqual({ done: 816 });
    expect(facets.actors).toEqual({ "agent:a": 5, system: 1 });
  });

  it("carries the same filter params as the page it counts for", async () => {
    const spy = fetchSpy().mockResolvedValue({
      statuses: {},
      priorities: {},
      actors: {},
      unread_count: 0,
    });
    await api.getArchivedInboxFacets({
      statuses: ["done"],
      priorities: [],
      actors: [],
      unreadOnly: true,
    });

    const [path] = spy.mock.calls[0] as unknown as [string];
    expect(path).toContain("statuses=done");
    expect(path).toContain("unread_only=true");
    // No `limit` — this is a count, not a page.
    expect(path).not.toContain("limit");
  });

  it("THROWS on a malformed body so the menu can say so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchSpy().mockResolvedValue({ statuses: "not an object" });

    await expect(api.getArchivedInboxFacets(EMPTY)).rejects.toThrow(
      "Invalid archived inbox facets response",
    );
    warn.mockRestore();
  });

  it("THROWS on a negative count", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchSpy().mockResolvedValue({
      statuses: { done: -1 },
      priorities: {},
      actors: {},
      unread_count: 0,
    });

    await expect(api.getArchivedInboxFacets(EMPTY)).rejects.toThrow(
      "Invalid archived inbox facets response",
    );
    warn.mockRestore();
  });
});
