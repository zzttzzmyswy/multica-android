/**
 * Cross-workspace unread summary — mobile API layer.
 *
 * Mirrors web's `api.getInboxUnreadSummary` (packages/core/api/client.ts:2177).
 * The endpoint is account-level (one entry per workspace with unread items),
 * so mobile needs its own method: mobile runs `apps/mobile/data/api.ts`, not
 * the core ApiClient singleton.
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

describe("getInboxUnreadSummary", () => {
  it("GETs /api/inbox/unread-summary with the abort signal", async () => {
    const spy = fetchSpy().mockResolvedValue([
      { workspace_id: "ws-2", count: 3 },
    ]);
    const signal = new AbortController().signal;
    await api.getInboxUnreadSummary({ signal });

    expect(spy).toHaveBeenCalledWith("/api/inbox/unread-summary", { signal });
  });

  it("returns the parsed per-workspace counts", async () => {
    fetchSpy().mockResolvedValue([
      { workspace_id: "ws-1", count: 0 },
      { workspace_id: "ws-2", count: 3 },
    ]);

    await expect(api.getInboxUnreadSummary()).resolves.toEqual([
      { workspace_id: "ws-1", count: 0 },
      { workspace_id: "ws-2", count: 3 },
    ]);
  });

  // Drift defense, same contract as listInbox: a malformed body must hide the
  // switcher dot, not take the workspace list (and with it every screen's
  // shell) down. parseWithFallback returns the empty summary.
  it("falls back to an empty summary on a malformed body", async () => {
    fetchSpy().mockResolvedValue({ not: "an array" });

    await expect(api.getInboxUnreadSummary()).resolves.toEqual([]);
  });

  it("falls back to an empty summary when rows are missing fields", async () => {
    fetchSpy().mockResolvedValue([{ workspace_id: "ws-2" }]);

    await expect(api.getInboxUnreadSummary()).resolves.toEqual([]);
  });

  it("keeps unknown extra fields rather than blanking the dot", async () => {
    fetchSpy().mockResolvedValue([
      { workspace_id: "ws-2", count: 1, future_field: "x" },
    ]);

    await expect(api.getInboxUnreadSummary()).resolves.toEqual([
      { workspace_id: "ws-2", count: 1, future_field: "x" },
    ]);
  });
});
