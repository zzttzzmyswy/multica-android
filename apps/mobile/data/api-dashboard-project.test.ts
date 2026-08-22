import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Same harness as api-failures.test.ts: ApiClient pulls in native modules at
// module scope, so the Node vitest lane stubs them. The env var satisfies
// api.ts's load-time guard; dynamic import keeps the assignment first.
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

// Iteration 87: page-scoped project filter. Every dashboard rollup accepts an
// optional projectId; when set the URL carries ?project_id=, when null the
// URL is byte-identical to the pre-iteration shape (?days= only) so the
// whole-workspace callers are untouched.
describe("dashboard rollups accept an optional project_id", () => {
  const CASES: Array<{
    name: string;
    call: (projectId: string | null) => Promise<unknown>;
    path: string;
  }> = [
    {
      name: "getDashboardUsageDaily",
      call: (p) => api.getDashboardUsageDaily(7, p),
      path: "/api/dashboard/usage/daily",
    },
    {
      name: "getDashboardUsageByAgent",
      call: (p) => api.getDashboardUsageByAgent(7, p),
      path: "/api/dashboard/usage/by-agent",
    },
    {
      name: "getDashboardFailuresDaily",
      call: (p) => api.getDashboardFailuresDaily(7, p),
      path: "/api/dashboard/failures/daily",
    },
    {
      name: "getDashboardFailuresByAgent",
      call: (p) => api.getDashboardFailuresByAgent(7, p),
      path: "/api/dashboard/failures/by-agent",
    },
    {
      name: "getDashboardAgentRunTime",
      call: (p) => api.getDashboardAgentRunTime(7, p),
      path: "/api/dashboard/agent-runtime",
    },
    {
      name: "getDashboardRunTimeDaily",
      call: (p) => api.getDashboardRunTimeDaily(7, p),
      path: "/api/dashboard/runtime/daily",
    },
  ];

  for (const c of CASES) {
    it(`${c.name} keeps ?days= only when projectId is null`, async () => {
      const spy = fetchSpy().mockResolvedValue([]);
      await c.call(null);
      expect(spy).toHaveBeenCalledWith(
        `${c.path}?days=7`,
        expect.objectContaining({ signal: undefined }),
      );
    });

    it(`${c.name} appends &project_id= when projectId is set`, async () => {
      const spy = fetchSpy().mockResolvedValue([]);
      await c.call("proj-abc");
      expect(spy).toHaveBeenCalledWith(
        `${c.path}?days=7&project_id=proj-abc`,
        expect.objectContaining({ signal: undefined }),
      );
    });
  }

  it("passes the abort signal through with a project filter", async () => {
    const spy = fetchSpy().mockResolvedValue([]);
    const signal = new AbortController().signal;
    await api.getDashboardUsageDaily(30, "proj-abc", { signal });
    expect(spy).toHaveBeenCalledWith(
      "/api/dashboard/usage/daily?days=30&project_id=proj-abc",
      expect.objectContaining({ signal }),
    );
  });
});