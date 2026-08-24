import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-102 actor-issues panel i18n (MYS-711).
// Same contract as members-keys.test.ts: every key resolves in BOTH locales
// and the zh value is actually translated.
describe("actor issues panel i18n", () => {
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
    "actorIssues.scopeAssigned": "已分配",
    "actorIssues.scopeCreated": "已创建",
    "actorIssues.searchPlaceholder": "搜索任务...",
    "actorIssues.searchEmpty": "没有匹配的任务。",
    "actorIssues.empty.assigned.title": "没有已分配的任务",
    "actorIssues.empty.assigned.description": "分配到这里的任务会显示在此视图中。",
    "actorIssues.empty.created.title": "没有已创建的任务",
    "actorIssues.empty.created.description": "由这里创建的任务会显示在此视图中。",
    "members.detail.issues": "任务",
    "agents.detail.workIssues": "关联任务",
    "issues.loadError": "问题加载失败：",
    "common.retry": "重试",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en).not.toBe(key); // en present (not the raw id fallback)
      expect(en.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zh);
      mod.setLocale("en");
    }
  });
});