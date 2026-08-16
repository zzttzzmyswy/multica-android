import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ApiClient pulls in native modules at module scope; the Node vitest lane
// stubs them so the import chain resolves. The env var satisfies api.ts's
// load-time guard. `api` is brought in via dynamic import (below) because
// static ESM imports are hoisted — they would evaluate data/api.ts before
// this file's top-level statements, so the process.env assignment would
// never land first.  Same pattern as api-subscription.test.ts.
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

describe("dashboard failure api methods", () => {
  it("getDashboardFailuresDaily GETs /api/dashboard/failures/daily?days=7", async () => {
    const spy = fetchSpy().mockResolvedValue([
      { date: "2026-08-15", failure_reason: "timeout", task_count: 2 },
    ]);
    const res = await api.getDashboardFailuresDaily(7);
    expect(spy).toHaveBeenCalledWith(
      "/api/dashboard/failures/daily?days=7",
      expect.objectContaining({ signal: undefined }),
    );
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ date: "2026-08-15", failure_reason: "timeout", task_count: 2 });
  });

  it("getDashboardFailuresDaily honours the abort signal", async () => {
    const spy = fetchSpy().mockResolvedValue([]);
    await api.getDashboardFailuresDaily(30, { signal: undefined });
    expect(spy).toHaveBeenCalledWith(
      "/api/dashboard/failures/daily?days=30",
      expect.objectContaining({ signal: undefined }),
    );
  });

  it("getDashboardFailuresDaily degrades a drift response to []", async () => {
    fetchSpy().mockResolvedValue({ not: "a list" });
    const res = await api.getDashboardFailuresDaily(7);
    expect(res).toEqual([]);
  });

  it("getDashboardFailuresByAgent GETs /api/dashboard/failures/by-agent?days=30", async () => {
    const spy = fetchSpy().mockResolvedValue([
      { agent_id: "agent-1", failure_reason: "runtime_offline", task_count: 4 },
    ]);
    const res = await api.getDashboardFailuresByAgent(30);
    expect(spy).toHaveBeenCalledWith(
      "/api/dashboard/failures/by-agent?days=30",
      expect.objectContaining({ signal: undefined }),
    );
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ agent_id: "agent-1", failure_reason: "runtime_offline" });
  });

  it("getDashboardFailuresByAgent degrades a drift response to []", async () => {
    fetchSpy().mockResolvedValue(null);
    const res = await api.getDashboardFailuresByAgent(7);
    expect(res).toEqual([]);
  });
});