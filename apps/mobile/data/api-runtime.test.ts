import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Same stub chain as api-failures.test.ts — ApiClient pulls in native modules
// at module scope, so the Node vitest lane stubs them and sets the API URL
// before the (dynamically imported) module evaluates.
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

describe("dashboard run-time api methods", () => {
  it("getDashboardAgentRunTime GETs /api/dashboard/agent-runtime?days=7", async () => {
    const spy = fetchSpy().mockResolvedValue([
      {
        agent_id: "agent-1",
        total_seconds: 9000,
        task_count: 5,
        failed_count: 1,
        cancelled_count: 0,
      },
    ]);
    const res = await api.getDashboardAgentRunTime(7);
    expect(spy).toHaveBeenCalledWith(
      "/api/dashboard/agent-runtime?days=7",
      expect.objectContaining({ signal: undefined }),
    );
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      agent_id: "agent-1",
      total_seconds: 9000,
      task_count: 5,
    });
  });

  it("getDashboardAgentRunTime honours the abort signal", async () => {
    const spy = fetchSpy().mockResolvedValue([]);
    await api.getDashboardAgentRunTime(30, { signal: undefined });
    expect(spy).toHaveBeenCalledWith(
      "/api/dashboard/agent-runtime?days=30",
      expect.objectContaining({ signal: undefined }),
    );
  });

  it("getDashboardAgentRunTime degrades a drift response to []", async () => {
    fetchSpy().mockResolvedValue({ not: "a list" });
    const res = await api.getDashboardAgentRunTime(7);
    expect(res).toEqual([]);
  });

  it("getDashboardRunTimeDaily GETs /api/dashboard/runtime/daily?days=30", async () => {
    const spy = fetchSpy().mockResolvedValue([
      {
        date: "2026-08-15",
        total_seconds: 3600,
        task_count: 4,
        failed_count: 1,
        cancelled_count: 1,
      },
    ]);
    const res = await api.getDashboardRunTimeDaily(30);
    expect(spy).toHaveBeenCalledWith(
      "/api/dashboard/runtime/daily?days=30",
      expect.objectContaining({ signal: undefined }),
    );
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ date: "2026-08-15", total_seconds: 3600 });
  });

  it("getDashboardRunTimeDaily defaults cancelled_count for an old backend row", async () => {
    fetchSpy().mockResolvedValue([
      { date: "2026-08-15", total_seconds: 60, task_count: 1, failed_count: 0 },
    ]);
    const res = await api.getDashboardRunTimeDaily(7);
    expect(res[0]?.cancelled_count).toBe(0);
  });

  it("getDashboardRunTimeDaily degrades a drift response to []", async () => {
    fetchSpy().mockResolvedValue(null);
    const res = await api.getDashboardRunTimeDaily(7);
    expect(res).toEqual([]);
  });
});