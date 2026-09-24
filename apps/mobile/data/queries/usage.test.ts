import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Same harness as api-failures.test.ts: data/api.ts pulls in native modules at
// module scope and guards on EXPO_PUBLIC_API_URL, so both modules are imported
// dynamically after the env assignment (static ESM imports would hoist).
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

type UsageMod = typeof import("./usage");
let mod: UsageMod;
let api: typeof import("../api").api;

beforeAll(async () => {
  ({ api } = await import("../api"));
  mod = await import("./usage");
});

beforeEach(() => {
  vi.restoreAllMocks();
});

// Iteration 87: projectId is part of every dashboard query's key so switching
// the page-scoped project refetches and each (ws, days, project) triple stays
// cached independently — the same days-in-key pattern already in use.
//
// Iteration 169 adds tz on the same terms: the server slices every day bucket
// on it, so a Preferences change has to repoint the cache rather than serve
// one zone's buckets under another zone's label.
describe("usage dashboard query options carry projectId and tz", () => {
  const TIMES: Array<{
    name: string;
    options: (p: string | null, tz: string) => { queryKey: readonly unknown[] };
    prefix: string;
  }> = [
    { name: "dashboardUsageDailyOptions", options: (p, tz) => mod.dashboardUsageDailyOptions("ws1", 7, p, tz), prefix: "usage-daily" },
    { name: "dashboardUsageByAgentOptions", options: (p, tz) => mod.dashboardUsageByAgentOptions("ws1", 7, p, tz), prefix: "usage-by-agent" },
    { name: "dashboardFailuresDailyOptions", options: (p, tz) => mod.dashboardFailuresDailyOptions("ws1", 7, p, tz), prefix: "failures-daily" },
    { name: "dashboardFailuresByAgentOptions", options: (p, tz) => mod.dashboardFailuresByAgentOptions("ws1", 7, p, tz), prefix: "failures-by-agent" },
    { name: "dashboardAgentRunTimeOptions", options: (p, tz) => mod.dashboardAgentRunTimeOptions("ws1", 7, p, tz), prefix: "agent-runtime" },
    { name: "dashboardRunTimeDailyOptions", options: (p, tz) => mod.dashboardRunTimeDailyOptions("ws1", 7, p, tz), prefix: "runtime-daily" },
  ];

  for (const c of TIMES) {
    it(`${c.name} puts projectId and tz in the queryKey`, () => {
      const nullKey = c.options(null, "UTC").queryKey as unknown[];
      const setKey = c.options("proj-abc", "UTC").queryKey as unknown[];
      expect(nullKey).toEqual(["dashboard", c.prefix, "ws1", 7, null, "UTC"]);
      expect(setKey).toEqual(["dashboard", c.prefix, "ws1", 7, "proj-abc", "UTC"]);
    });

    it(`${c.name} keeps a second timezone on its own cache entry`, () => {
      const shanghai = c.options(null, "Asia/Shanghai").queryKey;
      const kiritimati = c.options(null, "Pacific/Kiritimati").queryKey;
      expect(shanghai).not.toEqual(kiritimati);
    });
  }
});

describe("usage dashboard query options forward projectId and tz to the api", () => {
  it("routes every rollup's projectId and tz through", async () => {
    const spies = {
      usageDaily: vi.spyOn(api, "getDashboardUsageDaily").mockResolvedValue([]),
      usageByAgent: vi.spyOn(api, "getDashboardUsageByAgent").mockResolvedValue([]),
      failuresDaily: vi.spyOn(api, "getDashboardFailuresDaily").mockResolvedValue([]),
      failuresByAgent: vi.spyOn(api, "getDashboardFailuresByAgent").mockResolvedValue([]),
      agentRunTime: vi.spyOn(api, "getDashboardAgentRunTime").mockResolvedValue([]),
      runTimeDaily: vi.spyOn(api, "getDashboardRunTimeDaily").mockResolvedValue([]),
    };
    const signal = new AbortController().signal;
    // queryFn's runtime value only needs the abort signal; tsc wants the
    // full QueryFunctionContext, which the implementation never touches.
    const ctx = { signal } as never;

    const daily = mod.dashboardUsageDailyOptions("ws1", 7, "proj-abc", "Asia/Shanghai");
    await daily.queryFn!(ctx);
    expect(spies.usageDaily).toHaveBeenCalledWith(7, "proj-abc", "Asia/Shanghai", { signal });

    const byAgent = mod.dashboardUsageByAgentOptions("ws1", 7, null, "Asia/Shanghai");
    await byAgent.queryFn!(ctx);
    expect(spies.usageByAgent).toHaveBeenCalledWith(7, null, "Asia/Shanghai", { signal });

    const fDaily = mod.dashboardFailuresDailyOptions("ws1", 7, "proj-abc", "Asia/Shanghai");
    await fDaily.queryFn!(ctx);
    expect(spies.failuresDaily).toHaveBeenCalledWith(7, "proj-abc", "Asia/Shanghai", { signal });

    const fByAgent = mod.dashboardFailuresByAgentOptions("ws1", 7, null, "Asia/Shanghai");
    await fByAgent.queryFn!(ctx);
    expect(spies.failuresByAgent).toHaveBeenCalledWith(7, null, "Asia/Shanghai", { signal });

    const runTime = mod.dashboardAgentRunTimeOptions("ws1", 7, "proj-abc", "Asia/Shanghai");
    await runTime.queryFn!(ctx);
    expect(spies.agentRunTime).toHaveBeenCalledWith(7, "proj-abc", "Asia/Shanghai", { signal });

    const runTimeDaily = mod.dashboardRunTimeDailyOptions("ws1", 7, null, "Asia/Shanghai");
    await runTimeDaily.queryFn!(ctx);
    expect(spies.runTimeDaily).toHaveBeenCalledWith(7, null, "Asia/Shanghai", { signal });
  });

  it("keeps queryFn keys distinct per project", () => {
    const a = mod.dashboardUsageDailyOptions("ws1", 7, null, "UTC").queryKey;
    const b = mod.dashboardUsageDailyOptions("ws1", 7, "p1", "UTC").queryKey;
    expect(a).not.toEqual(b);
  });
});
// Iteration 171: the page re-polls on the server's own rollup cadence, and a
// range change keeps the previous result mounted instead of falling back to a
// skeleton. Both are web parity (packages/core/dashboard/queries.ts:45-65).
describe("usage dashboard polling and range transitions", () => {
  const ALL = [
    { name: "dashboardUsageDailyOptions", options: (days: number, ws = "ws1") => mod.dashboardUsageDailyOptions(ws, days, null, "UTC") },
    { name: "dashboardUsageByAgentOptions", options: (days: number, ws = "ws1") => mod.dashboardUsageByAgentOptions(ws, days, null, "UTC") },
    { name: "dashboardFailuresDailyOptions", options: (days: number, ws = "ws1") => mod.dashboardFailuresDailyOptions(ws, days, null, "UTC") },
    { name: "dashboardFailuresByAgentOptions", options: (days: number, ws = "ws1") => mod.dashboardFailuresByAgentOptions(ws, days, null, "UTC") },
    { name: "dashboardAgentRunTimeOptions", options: (days: number, ws = "ws1") => mod.dashboardAgentRunTimeOptions(ws, days, null, "UTC") },
    { name: "dashboardRunTimeDailyOptions", options: (days: number, ws = "ws1") => mod.dashboardRunTimeDailyOptions(ws, days, null, "UTC") },
  ];

  /** `placeholderData` is typed as value-or-function; the implementation is
   *  always the function, and that is the part under test. */
  const placeholders = (options: { placeholderData?: unknown }) =>
    options.placeholderData as (
      previous: unknown,
      previousQuery: { queryKey: readonly unknown[] } | undefined,
    ) => unknown;

  for (const c of ALL) {
    it(`${c.name} re-polls on the server's 5-minute rollup cadence`, () => {
      expect(c.options(7).refetchInterval).toBe(5 * 60 * 1000);
    });
  }

  for (const c of ALL) {
    it(`${c.name} keeps the previous result across a range change`, () => {
      const next = c.options(7);
      const previousQuery = { queryKey: c.options(30).queryKey };
      // keepPreviousData is the identity function, so the previous rows must
      // come straight back; anything else (undefined) means the guard rejected
      // the transition and the caller falls back to a skeleton.
      const previous = [{ date: "2026-08-25" }];
      expect(placeholders(next)(previous, previousQuery)).toBe(previous);
    });
  }

  for (const c of ALL) {
    it(`${c.name} drops the previous result across a workspace change`, () => {
      const next = c.options(7, "ws2");
      const previousQuery = { queryKey: c.options(7, "ws1").queryKey };
      expect(placeholders(next)([{ date: "x" }], previousQuery)).toBeUndefined();
    });
  }

  for (const c of ALL) {
    it(`${c.name} drops the previous result across a timezone change`, () => {
      const next = c.options(7);
      const other = c.options(7);
      const otherTzQuery = {
        queryKey: [...other.queryKey.slice(0, 5), "Pacific/Kiritimati"],
      };
      expect(placeholders(next)([{ date: "x" }], otherTzQuery)).toBeUndefined();
    });
  }

  it("drops the previous result when there is no previous query", () => {
    const next = mod.dashboardUsageDailyOptions("ws1", 7, null, "UTC");
    expect(placeholders(next)([{ date: "x" }], undefined)).toBeUndefined();
  });
});
