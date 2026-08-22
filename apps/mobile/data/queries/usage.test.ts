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
describe("usage dashboard query options carry projectId", () => {
  const TIMES: Array<{
    name: string;
    options: (p: string | null) => { queryKey: readonly unknown[] };
    prefix: string;
  }> = [
    { name: "dashboardUsageDailyOptions", options: (p) => mod.dashboardUsageDailyOptions("ws1", 7, p), prefix: "usage-daily" },
    { name: "dashboardUsageByAgentOptions", options: (p) => mod.dashboardUsageByAgentOptions("ws1", 7, p), prefix: "usage-by-agent" },
    { name: "dashboardFailuresDailyOptions", options: (p) => mod.dashboardFailuresDailyOptions("ws1", 7, p), prefix: "failures-daily" },
    { name: "dashboardFailuresByAgentOptions", options: (p) => mod.dashboardFailuresByAgentOptions("ws1", 7, p), prefix: "failures-by-agent" },
    { name: "dashboardAgentRunTimeOptions", options: (p) => mod.dashboardAgentRunTimeOptions("ws1", 7, p), prefix: "agent-runtime" },
    { name: "dashboardRunTimeDailyOptions", options: (p) => mod.dashboardRunTimeDailyOptions("ws1", 7, p), prefix: "runtime-daily" },
  ];

  for (const c of TIMES) {
    it(`${c.name} puts projectId in the queryKey`, () => {
      const nullKey = c.options(null).queryKey as unknown[];
      const setKey = c.options("proj-abc").queryKey as unknown[];
      expect(nullKey).toEqual(["dashboard", c.prefix, "ws1", 7, null]);
      expect(setKey).toEqual(["dashboard", c.prefix, "ws1", 7, "proj-abc"]);
    });
  }
});

describe("usage dashboard query options forward projectId to the api", () => {
  it("routes every rollup's projectId through", async () => {
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

    const daily = mod.dashboardUsageDailyOptions("ws1", 7, "proj-abc");
    await daily.queryFn!(ctx);
    expect(spies.usageDaily).toHaveBeenCalledWith(7, "proj-abc", { signal });

    const byAgent = mod.dashboardUsageByAgentOptions("ws1", 7, null);
    await byAgent.queryFn!(ctx);
    expect(spies.usageByAgent).toHaveBeenCalledWith(7, null, { signal });

    const fDaily = mod.dashboardFailuresDailyOptions("ws1", 7, "proj-abc");
    await fDaily.queryFn!(ctx);
    expect(spies.failuresDaily).toHaveBeenCalledWith(7, "proj-abc", { signal });

    const fByAgent = mod.dashboardFailuresByAgentOptions("ws1", 7, null);
    await fByAgent.queryFn!(ctx);
    expect(spies.failuresByAgent).toHaveBeenCalledWith(7, null, { signal });

    const runTime = mod.dashboardAgentRunTimeOptions("ws1", 7, "proj-abc");
    await runTime.queryFn!(ctx);
    expect(spies.agentRunTime).toHaveBeenCalledWith(7, "proj-abc", { signal });

    const runTimeDaily = mod.dashboardRunTimeDailyOptions("ws1", 7, null);
    await runTimeDaily.queryFn!(ctx);
    expect(spies.runTimeDaily).toHaveBeenCalledWith(7, null, { signal });
  });

  it("keeps queryFn keys distinct per project", () => {
    const a = mod.dashboardUsageDailyOptions("ws1", 7, null).queryKey;
    const b = mod.dashboardUsageDailyOptions("ws1", 7, "p1").queryKey;
    expect(a).not.toEqual(b);
  });
});