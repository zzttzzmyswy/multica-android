import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ApiClient pulls in native modules at module scope; the Node vitest lane
// stubs them so the import chain resolves (same pattern as
// downloads-store.test.ts). The env var satisfies api.ts's load-time guard.
// NOTE: `api` is brought in via dynamic import (below) because static ESM
// imports are hoisted — they would evaluate data/api.ts before this file's
// top-level statements, so the process.env assignment would never land first.
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

describe("issue subscription api methods", () => {
  it("listIssueSubscribers GETs /api/issues/:id/subscribers", async () => {
    const spy = fetchSpy().mockResolvedValue([]);
    await api.listIssueSubscribers("issue-1");
    expect(spy).toHaveBeenCalledWith(
      "/api/issues/issue-1/subscribers",
      expect.objectContaining({ signal: undefined }),
    );
  });

  it("subscribeIssue POSTs to /api/issues/:id/subscribe and validates {subscribed}", async () => {
    const spy = fetchSpy().mockResolvedValue({ subscribed: true });
    const res = await api.subscribeIssue("issue-1");
    expect(spy).toHaveBeenCalledWith(
      "/api/issues/issue-1/subscribe",
      expect.objectContaining({ method: "POST" }),
    );
    expect(res.subscribed).toBe(true);
  });

  it("unsubscribeIssue POSTs to /api/issues/:id/unsubscribe", async () => {
    const spy = fetchSpy().mockResolvedValue({ subscribed: false });
    const res = await api.unsubscribeIssue("issue-1");
    expect(spy).toHaveBeenCalledWith(
      "/api/issues/issue-1/unsubscribe",
      expect.objectContaining({ method: "POST" }),
    );
    expect(res.subscribed).toBe(false);
  });

  it("unsubscribeIssueSubtree POSTs to /api/issues/:id/unsubscribe/subtree", async () => {
    const spy = fetchSpy().mockResolvedValue({ subscribed: false });
    await api.unsubscribeIssueSubtree("issue-1");
    expect(spy).toHaveBeenCalledWith(
      "/api/issues/issue-1/unsubscribe/subtree",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("tolerates an empty response body after subscribe (defaults subscribed:false)", async () => {
    fetchSpy().mockResolvedValue({});
    const res = await api.subscribeIssue("issue-1");
    expect(res.subscribed).toBe(false);
  });
});

describe("rerunIssue", () => {
  it("POSTs to /api/issues/:id/rerun with no body when no task given", async () => {
    const spy = fetchSpy().mockResolvedValue({ id: "task-1" });
    const res = await api.rerunIssue("issue-1");
    expect(spy).toHaveBeenCalledWith("/api/issues/issue-1/rerun", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.id).toBe("task-1");
  });

  it("sends task_id when a specific run is targeted", async () => {
    const spy = fetchSpy().mockResolvedValue({ id: "task-2" });
    await api.rerunIssue("issue-1", "task-9");
    expect(spy).toHaveBeenCalledWith("/api/issues/issue-1/rerun", {
      method: "POST",
      body: JSON.stringify({ task_id: "task-9" }),
    });
  });
});