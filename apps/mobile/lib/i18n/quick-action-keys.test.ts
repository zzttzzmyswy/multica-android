import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-94 issue sidebar quick-actions i18n
// (MYS-680). Every key exists in BOTH locales and the zh values are real
// translations aligned with web's packages/views/locales details.
describe("issue quick-actions section i18n", () => {
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

  const KEYS = [
    "issue.qa.sectionTitle",
    "issue.qa.showMore",
    "issue.qa.runsAs",
    "issue.qa.targetFallback",
    "issue.qa.queued",
    "issue.qa.coalesced",
    "issue.qa.deferred",
    "issue.qa.blockedRun",
    "issue.qa.posted",
    "issue.qa.blockedTitle",
    "issue.qa.blockedBody",
    "issue.qa.blockedOk",
  ];

  const ZH_SPOT: Record<string, string> = {
    "issue.qa.sectionTitle": "快捷操作",
    "issue.qa.showMore": "显示其余 {{count}} 条",
    "issue.qa.runsAs": "由 {{name}} 执行",
    "issue.qa.targetFallback": "该 Agent",
    "issue.qa.queued": "{{name}} 已开始处理",
    "issue.qa.coalesced": "已加入 {{name}} 当前的 task",
    "issue.qa.deferred": "{{name}} 当前离线，上线后开始",
    "issue.qa.blockedRun": "无法触发 {{name}}",
    "issue.qa.posted": "评论已发布",
    "issue.qa.blockedTitle": "你无法执行这条快捷操作",
    "issue.qa.blockedOk": "知道了",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const key of KEYS) {
      const en = mod.translate(key);
      expect(en).not.toBe(key);
      expect(en.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      const zh = mod.translate(key);
      expect(zh).not.toBe(key);
      expect(zh.length).toBeGreaterThan(0);
      if (key in ZH_SPOT) {
        expect(zh).toBe(ZH_SPOT[key]);
      }
      mod.setLocale("en");
    }
  });

  it("en/zh key sets stay in parity (no key lives in only one locale)", () => {
    for (const key of KEYS) {
      mod.setLocale("en");
      expect(mod.translate(key)).not.toBe(key);
      mod.setLocale("zh");
      expect(mod.translate(key)).not.toBe(key);
    }
  });

  it("interpolates name/count in both locales", () => {
    mod.setLocale("en");
    expect(mod.translate("issue.qa.queued", { name: "OrderBot" })).toBe(
      "OrderBot started working",
    );
    expect(mod.translate("issue.qa.showMore", { count: 3 })).toBe(
      "Show 3 more",
    );
    expect(mod.translate("issue.qa.deferred", { name: "OrderBot" })).toBe(
      "OrderBot is offline — it will start once back online",
    );

    mod.setLocale("zh");
    expect(mod.translate("issue.qa.queued", { name: "OrderBot" })).toBe(
      "OrderBot 已开始处理",
    );
    expect(mod.translate("issue.qa.showMore", { count: 3 })).toBe(
      "显示其余 3 条",
    );
  });
});