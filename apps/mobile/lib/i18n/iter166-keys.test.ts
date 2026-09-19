import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n spot-checks for iteration 166 — the runtime-detail "Serving" card and
// the Owner fact row. Same contract as iter119/…/iter165-keys.test.ts: every
// key resolves in BOTH locales and the zh value is a real translation, not the
// raw-id fallback.
//
// The two `{{count}}` keys are the load-bearing ones: mobile's `translate()`
// does no plural resolution, so a web-style `serving_count_one` /
// `serving_count_other` pair would never be looked up and the card header
// would print the raw id.
describe("runtime serving card i18n (iteration 166)", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  async function loadI18n() {
    return await import("./index");
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await loadI18n();
    mod.resetI18nForTests();
    mod.setLocale("en");
  });

  const ZH_SPOT: Record<string, string> = {
    "runtimes.detail.servingTitle": "服务中",
    "runtimes.detail.servingCount": "{{count}} 个智能体",
    "runtimes.detail.noAgents": "还没有智能体绑定到这个运行时。",
    "runtimes.detail.runningChip": "· {{count}} 个进行中",
    "runtimes.detail.queuedChip": "· {{count}} 个排队中",
    "runtimes.detail.owner": "所有者",
    "agents.workload.working": "处理中",
    "agents.workload.queued": "排队中",
  };

  it("resolves every iteration-166 key in both locales", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const enValue = mod.translate(key);
      expect(enValue, `en fallback leak: ${key}`).not.toBe(key);
      expect(enValue.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("interpolates the serving count and the workload chips", () => {
    mod.setLocale("en");
    expect(mod.translate("runtimes.detail.servingCount", { count: 2 })).toBe(
      "2 agents",
    );
    expect(mod.translate("runtimes.detail.runningChip", { count: 1 })).toBe(
      "· 1 running",
    );
    expect(mod.translate("runtimes.detail.queuedChip", { count: 4 })).toBe(
      "· 4 queued",
    );

    mod.setLocale("zh");
    expect(mod.translate("runtimes.detail.servingCount", { count: 2 })).toBe(
      "2 个智能体",
    );
    expect(mod.translate("runtimes.detail.queuedChip", { count: 4 })).toBe(
      "· 4 个排队中",
    );
  });

  it("mirrors the web serving card wording", () => {
    // packages/views/locales/{en,zh-Hans}/runtimes.json detail.serving_title,
    // detail.no_agents and agents.json workload.{working,queued} — the phone
    // must not invent a second vocabulary for the same states.
    mod.setLocale("en");
    expect(mod.translate("runtimes.detail.servingTitle")).toBe("Serving");
    expect(mod.translate("runtimes.detail.noAgents")).toBe(
      "No agents are bound to this runtime yet.",
    );
    expect(mod.translate("agents.workload.working")).toBe("Working");
    expect(mod.translate("agents.workload.queued")).toBe("Queued");
  });
});
