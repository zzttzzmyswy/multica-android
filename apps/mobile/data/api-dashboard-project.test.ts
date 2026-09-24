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
// URL is byte-identical to the pre-iteration shape so the whole-workspace
// callers are untouched.
//
// Iteration 169: every rollup also carries the viewer's ?tz=. The server
// slices each day bucket on it, so a call that omits it answers in UTC — a
// different question from the one web's dashboard asks for the same account.
describe("dashboard rollups carry project_id and tz", () => {
  const CASES: Array<{
    name: string;
    call: (projectId: string | null, tz: string) => Promise<unknown>;
    path: string;
  }> = [
    {
      name: "getDashboardUsageDaily",
      call: (p, tz) => api.getDashboardUsageDaily(7, p, tz),
      path: "/api/dashboard/usage/daily",
    },
    {
      name: "getDashboardUsageByAgent",
      call: (p, tz) => api.getDashboardUsageByAgent(7, p, tz),
      path: "/api/dashboard/usage/by-agent",
    },
    {
      name: "getDashboardFailuresDaily",
      call: (p, tz) => api.getDashboardFailuresDaily(7, p, tz),
      path: "/api/dashboard/failures/daily",
    },
    {
      name: "getDashboardFailuresByAgent",
      call: (p, tz) => api.getDashboardFailuresByAgent(7, p, tz),
      path: "/api/dashboard/failures/by-agent",
    },
    {
      name: "getDashboardAgentRunTime",
      call: (p, tz) => api.getDashboardAgentRunTime(7, p, tz),
      path: "/api/dashboard/agent-runtime",
    },
    {
      name: "getDashboardRunTimeDaily",
      call: (p, tz) => api.getDashboardRunTimeDaily(7, p, tz),
      path: "/api/dashboard/runtime/daily",
    },
  ];

  for (const c of CASES) {
    it(`${c.name} keeps the whole-workspace shape plus ?tz=`, async () => {
      const spy = fetchSpy().mockResolvedValue([]);
      await c.call(null, "UTC");
      expect(spy).toHaveBeenCalledWith(
        `${c.path}?days=7&tz=UTC`,
        expect.objectContaining({ signal: undefined }),
      );
    });

    it(`${c.name} appends &project_id= when projectId is set`, async () => {
      const spy = fetchSpy().mockResolvedValue([]);
      await c.call("proj-abc", "UTC");
      expect(spy).toHaveBeenCalledWith(
        `${c.path}?days=7&project_id=proj-abc&tz=UTC`,
        expect.objectContaining({ signal: undefined }),
      );
    });

    it(`${c.name} percent-encodes an IANA zone id`, async () => {
      const spy = fetchSpy().mockResolvedValue([]);
      await c.call(null, "Pacific/Kiritimati");
      expect(spy).toHaveBeenCalledWith(
        `${c.path}?days=7&tz=Pacific%2FKiritimati`,
        expect.objectContaining({ signal: undefined }),
      );
    });
  }

  it("passes the abort signal through with a project filter", async () => {
    const spy = fetchSpy().mockResolvedValue([]);
    const signal = new AbortController().signal;
    await api.getDashboardUsageDaily(30, "proj-abc", "UTC", { signal });
    expect(spy).toHaveBeenCalledWith(
      "/api/dashboard/usage/daily?days=30&project_id=proj-abc&tz=UTC",
      expect.objectContaining({ signal }),
    );
  });
});