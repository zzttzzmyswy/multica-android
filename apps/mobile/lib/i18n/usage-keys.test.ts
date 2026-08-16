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
    "usage.errorsTab": "错误",
    "usage.errors.kpiFailedLabel": "失败任务 · {{days}}天",
    "usage.errors.kpiFailedHint": "共 {{total}} 次运行",
    "usage.errors.kpiRateLabel": "失败率 · {{days}}天",
    "usage.errors.kpiAgentsLabel": "受影响 agent · {{days}}天",
    "usage.errors.kpiAgentsHint": "最多 {{name}} · {{count}} 次",
    "usage.errors.trendTitle": "每日失败",
    "usage.errors.summary": "{{total}} 次运行中有 {{failed}} 次失败 · {{rate}}",
    "usage.errors.mixTitle": "失败构成 · {{failed}}",
    "usage.errors.mixLabel": "失败构成",
    "usage.errors.codesLabel": "错误码",
    "usage.errors.byAgent": "问题最多的 agent",
    "usage.errors.sortLabel": "排序依据",
    "usage.errors.sortFailed": "失败数",
    "usage.errors.sortRate": "失败率",
    "usage.errors.headerAgent": "agent",
    "usage.errors.headerFailed": "失败",
    "usage.errors.headerRuns": "运行",
    "usage.errors.headerRate": "失败率",
    "usage.errors.otherAgents": "其他 agent",
    "usage.errors.lowSample": "所选时间范围内运行不足 {{count}} 次，失败率参考价值有限。",
    "usage.errors.noData": "所选时间范围内没有失败的运行。",
    "usage.errors.showReasons": "展开错误码",
    "usage.errors.hideReasons": "收起错误码",
    "usage.errors.showAll": "展开全部 {{count}} 个",
    "usage.errors.showLess": "只看前 {{count}} 个",
    "usage.errors.class.auth": "认证",
    "usage.errors.class.rateLimit": "限流",
    "usage.errors.class.timeout": "超时",
    "usage.errors.class.provider": "模型服务",
    "usage.errors.class.runtime": "运行时",
    "usage.errors.class.agent": "智能体",
    "usage.errors.class.other": "其他",
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