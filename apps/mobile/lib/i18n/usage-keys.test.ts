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
    "usage.emptyDescription": "智能体跑起 task 后，token 用量会显示在这里。",
    "usage.range1": "1天",
    "usage.range7": "7天",
    "usage.range30": "30天",
    "usage.range90": "90天",
    "usage.range180": "180天",
    "usage.projectAll": "全部项目",
    "usage.projectFilterLabel": "项目",
    "usage.periodLabel": "时间范围",
    "usage.totalCost": "费用",
    "usage.totalTokens": "Token",
    "usage.totalTasks": "task 数",
    "usage.trendTab": "趋势",
    "usage.leaderboardTab": "排行",
    "usage.dayTrendTitle": "每日 Token",
    "usage.dayTrendCostTitle": "每日费用",
    "usage.noData": "该时段暂无数据",
    "usage.inputLabel": "输入",
    "usage.outputLabel": "输出",
    "usage.cacheLabel": "缓存",
    "usage.cacheWriteLabel": "缓存写入",
    "usage.tasksShort": "task",
    "usage.deletedAgents": "已删除的智能体",
    "usage.otherAgents": "其他智能体",
    "usage.unknownAgent": "未知智能体",
    "usage.errorsTab": "错误",
    "usage.errors.kpiFailedLabel": "失败 task · {{days}}天",
    "usage.errors.kpiFailedHint": "共 {{total}} 次运行",
    "usage.errors.kpiRateLabel": "失败率 · {{days}}天",
    "usage.errors.kpiAgentsLabel": "受影响智能体 · {{days}}天",
    "usage.errors.kpiAgentsHint": "最多 {{name}} · {{count}} 次",
    "usage.errors.trendTitle": "每日失败",
    "usage.errors.summary": "{{total}} 次运行中有 {{failed}} 次失败 · {{rate}}",
    "usage.errors.mixTitle": "失败构成 · {{failed}}",
    "usage.errors.mixLabel": "失败构成",
    "usage.errors.codesLabel": "错误码",
    "usage.errors.byAgent": "问题最多的智能体",
    "usage.errors.sortLabel": "排序依据",
    "usage.errors.sortFailed": "失败数",
    "usage.errors.sortRate": "失败率",
    "usage.errors.headerAgent": "智能体",
    "usage.errors.headerFailed": "失败",
    "usage.errors.headerRuns": "运行",
    "usage.errors.headerRate": "失败率",
    "usage.errors.otherAgents": "其他智能体",
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
    "usage.totalRunTime": "运行时长",
    "usage.totalRunTimeHint": "共 {{tasks}} 个 task",
    "usage.totalTasksHint": "失败 {{failed}} 个",
    "usage.leaderboardTitle": "排行",
    "usage.leaderboardCaption": "{{count}} 个智能体",
    "usage.leaderboardCaptionDeleted": "{{count}} 个智能体 · {{deleted}} 个已删除",
    "usage.leaderboardShowAll": "展开全部",
    "usage.leaderboardShowLess": "只看前 {{count}} 个",
    "usage.totalCostLabel": "费用 · {{days}}天",
    "usage.totalTokensLabel": "Token · {{days}}天",
    "usage.totalRunTimeLabel": "运行时长 · {{days}}天",
    "usage.totalTasksLabel": "task 数 · {{days}}天",
    "usage.totalTokensHint": "输入 {{input}} · 输出 {{output}}",
    "usage.legendInput": "输入",
    "usage.legendOutput": "输出",
    "usage.legendCacheRead": "缓存读取",
    "usage.legendCacheWrite": "缓存写入",
    "usage.headerTimezoneUpdated": "{{tz}} · 更新于 {{time}}",
    "usage.metricTokens": "Token",
    "usage.metricTime": "运行时长",
    "usage.metricCost": "费用",
    "usage.metricTasks": "task 数",
    "usage.dayTrendTimeTitle": "每日运行时长",
    "usage.dayTrendTasksTitle": "每日 task 数",
    "usage.timeLabel": "时长",
    "usage.completedLabel": "完成",
    "usage.failedLabel": "失败",
    "usage.cancelledLabel": "取消",
    "usage.lessThanMinute": "<1分钟",
    "usage.dimDaily": "按天",
    "usage.dimWeekly": "按周",
    "usage.weekTrendTitle": "每周 Token",
    "usage.weekTrendCostTitle": "每周费用",
    "usage.weekTrendTimeTitle": "每周运行时长",
    "usage.weekTrendTasksTitle": "每周 task 数",
    "usage.errors.weekTrendTitle": "每周失败",
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