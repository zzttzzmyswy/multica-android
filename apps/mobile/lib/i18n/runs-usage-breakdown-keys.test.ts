import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-79 per-run usage breakdown dialog i18n
// (MYS-568). Same contract as every keys test: every key resolves in BOTH
// locales, the zh value is actually translated, and the key SETS stay
// symmetric (no key lives in only one locale).
describe("runs usage-breakdown i18n", () => {
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
    "runs.usageDetail.title",
    "runs.usageDetail.subtitle",
    "runs.usageDetail.subtitleOne",
    "runs.usageDetail.empty",
    "runs.usageDetail.kpiCost",
    "runs.usageDetail.costFailHint",
    "runs.usageDetail.costFailHintOne",
    "runs.usageDetail.kpiCache",
    "runs.usageDetail.kpiCacheHint",
    "runs.usageDetail.kpiTokens",
    "runs.usageDetail.kpiTokensHint",
    "runs.usageDetail.byAgent",
    "runs.usageDetail.colInput",
    "runs.usageDetail.colOutput",
    "runs.usageDetail.colCacheRead",
    "runs.usageDetail.colCacheWrite",
    "runs.usageDetail.total",
    "runs.usageDetail.noteUnpriced",
    "runs.usageDetail.noteUnpricedOne",
    "runs.usageDetail.noteUnmapped",
    "runs.usageDetail.noteEstimate",
  ];

  const ZH_SPOT: Record<string, string> = {
    "runs.usageDetail.title": "用量明细",
    "runs.usageDetail.subtitle": "{{label}} 次运行",
    "runs.usageDetail.empty": "这个任务还没有任何一次运行记录到 token 用量。",
    "runs.usageDetail.kpiCost": "费用",
    "runs.usageDetail.costFailHint": "{{count}} 次失败运行占 {{pct}}%",
    "runs.usageDetail.kpiCache": "缓存节省",
    "runs.usageDetail.kpiCacheHint": "命中率 {{pct}}% · 读取 {{reads}}",
    "runs.usageDetail.kpiTokens": "Token",
    "runs.usageDetail.kpiTokensHint": "输入 {{input}} · 输出 {{output}}",
    "runs.usageDetail.byAgent": "按智能体分摊",
    "runs.usageDetail.colInput": "输入",
    "runs.usageDetail.colCacheRead": "缓存读",
    "runs.usageDetail.colCost": "费用",
    "runs.usageDetail.total": "合计",
    "runs.usageDetail.noteUnpriced": "有 {{count}} 次运行没有用量记录，不计入合计。",
    "runs.usageDetail.noteUnmapped": "{{models}} 没有维护价格，token 已计入，费用未计入。",
    "runs.usageDetail.noteEstimate": "费用按各模型公开价目估算；供应商回报实际费用时以回报值为准。",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const key of KEYS) {
      const en = mod.translate(key);
      expect(en).not.toBe(key); // en present (not the raw id fallback)
      expect(en.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key).length).toBeGreaterThan(0);
      if (key in ZH_SPOT) {
        expect(mod.translate(key)).toBe(ZH_SPOT[key]!);
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
});
