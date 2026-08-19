/**
 * Inbox API-layer tests for the iteration-72 archived-inbox surface
 * (listArchivedInbox / unarchiveInbox / markInboxUnread). Same contract as
 * api-subscription.test.ts: the low-level `fetch` is stubbed and each method's
 * URL, verb and (for the list endpoint) schema-fallback behavior is pinned.
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

function archivedRow(id: string) {
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
    body: "",
    issue_status: "done",
    read: true,
    archived: true,
    created_at: "2026-08-01T00:00:00Z",
    details: { from: "in_progress", to: "done" },
  };
}

describe("inbox api methods", () => {
  it("listArchivedInbox GETs /api/inbox/archived with the abort signal", async () => {
    const spy = fetchSpy().mockResolvedValue([archivedRow("arch-1")]);
    const res = await api.listArchivedInbox({ signal: undefined });

    expect(spy).toHaveBeenCalledWith(
      "/api/inbox/archived",
      expect.objectContaining({ signal: undefined }),
    );
    expect(res[0]?.id).toBe("arch-1");
    expect(res[0]?.archived).toBe(true);
  });

  it("listArchivedInbox falls back to an empty list on a malformed payload", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchSpy().mockResolvedValue({ not: "an array" });

    expect(await api.listArchivedInbox()).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("unarchiveInbox POSTs to /api/inbox/:id/unarchive", async () => {
    const spy = fetchSpy().mockResolvedValue({
      ...archivedRow("arch-1"),
      archived: false,
    });
    const res = await api.unarchiveInbox("arch-1");

    expect(spy).toHaveBeenCalledWith(
      "/api/inbox/arch-1/unarchive",
      expect.objectContaining({ method: "POST" }),
    );
    expect(res.archived).toBe(false);
  });

  it("markInboxUnread POSTs to /api/inbox/:id/unread", async () => {
    const spy = fetchSpy().mockResolvedValue({
      ...archivedRow("main-1"),
      read: false,
    });
    const res = await api.markInboxUnread("main-1");

    expect(spy).toHaveBeenCalledWith(
      "/api/inbox/main-1/unread",
      expect.objectContaining({ method: "POST" }),
    );
    expect(res.read).toBe(false);
  });
});