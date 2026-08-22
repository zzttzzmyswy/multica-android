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

describe("dashboard usage api methods (iteration-87 project filter)", () => {
  it("getDashboardUsageDaily GETs /api/dashboard/usage/daily?days=7", async () => {
    const spy = fetchSpy().mockResolvedValue([
      { date: "2026-08-15", input_tokens: 1000, output_tokens: 200, task_count: 3 },
    ]);
    const res = await api.getDashboardUsageDaily(7);
    expect(spy).toHaveBeenCalledWith(
      "/api/dashboard/usage/daily?days=7",
      expect.objectContaining({ signal: undefined }),
    );
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      date: "2026-08-15",
      input_tokens: 1000,
      output_tokens: 200,
    });
  });

  it("getDashboardUsageDaily honours the abort signal", async () => {
    const spy = fetchSpy().mockResolvedValue([]);
    await api.getDashboardUsageDaily(30, undefined, { signal: undefined });
    expect(spy).toHaveBeenCalledWith(
      "/api/dashboard/usage/daily?days=30",
      expect.objectContaining({ signal: undefined }),
    );
  });

  it("getDashboardUsageDaily appends project_id when a project is selected", async () => {
    const spy = fetchSpy().mockResolvedValue([]);
    await api.getDashboardUsageDaily(7, "project-1");
    expect(spy).toHaveBeenCalledWith(
      "/api/dashboard/usage/daily?days=7&project_id=project-1",
      expect.objectContaining({ signal: undefined }),
    );
  });

  it("getDashboardUsageDaily degrades a drift response to []", async () => {
    fetchSpy().mockResolvedValue({ not: "a list" });
    const res = await api.getDashboardUsageDaily(7);
    expect(res).toEqual([]);
  });

  it("getDashboardUsageByAgent GETs /api/dashboard/usage/by-agent?days=30", async () => {
    const spy = fetchSpy().mockResolvedValue([
      { agent_id: "agent-1", input_tokens: 500, task_count: 2 },
    ]);
    const res = await api.getDashboardUsageByAgent(30);
    expect(spy).toHaveBeenCalledWith(
      "/api/dashboard/usage/by-agent?days=30",
      expect.objectContaining({ signal: undefined }),
    );
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ agent_id: "agent-1", input_tokens: 500 });
  });

  it("getDashboardUsageByAgent appends project_id when a project is selected", async () => {
    const spy = fetchSpy().mockResolvedValue([]);
    await api.getDashboardUsageByAgent(7, "project-2");
    expect(spy).toHaveBeenCalledWith(
      "/api/dashboard/usage/by-agent?days=7&project_id=project-2",
      expect.objectContaining({ signal: undefined }),
    );
  });

  it("getDashboardUsageByAgent degrades a drift response to []", async () => {
    fetchSpy().mockResolvedValue(null);
    const res = await api.getDashboardUsageByAgent(7);
    expect(res).toEqual([]);
  });
});