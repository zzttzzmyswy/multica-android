import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-34 usage-screen i18n. Same contract as
// runtimes-keys.test.ts: every key resolves in BOTH locales and the zh
// value is actually translated.
describe("usage i18n", () => {
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
    "nav.usage": "用量",
    "screen.usage": "用量",
    "usage.loadError": "加载用量失败：",
    "usage.emptyTitle": "暂无用量数据",
    "usage.emptyDescription": "agent 完成任务后，token 用量会显示在这里。",
    "usage.range7": "7 天",
    "usage.range30": "30 天",
    "usage.totalTokens": "Token",
    "usage.totalTasks": "任务",
    "usage.agents": "活跃 agent",
    "usage.trendTab": "趋势",
    "usage.leaderboardTab": "排行",
    "usage.dayTrendTitle": "每日 Token",
    "usage.noData": "该时段暂无数据",
    "usage.inputLabel": "输入",
    "usage.outputLabel": "输出",
    "usage.cacheLabel": "缓存",
    "usage.tasksShort": "任务",
    "usage.deletedAgents": "已删除的 agent",
    "usage.otherAgents": "其他 agent",
    "usage.unknownAgent": "未知 agent",
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