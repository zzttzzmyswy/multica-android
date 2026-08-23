import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-91 properties management page i18n (MYS-668,
// aligns web settings.properties.*). Same contract as squads-keys.test.ts:
// every key resolves in BOTH locales (a zh tag proves the en key is real, and
// vice versa) and the zh value is actually translated.
describe("properties management page i18n", () => {
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
    "screen.properties": "属性",
    "nav.properties": "属性",
    "properties.adminHint": "仅有工作区 owner 和 admin 可以管理属性。",
    "properties.searchPlaceholder": "按名称筛选…",
    "properties.noResults": "无匹配的属性",
    "properties.usageCount": "{{count}} 个 issue",
    "properties.limitHint": "已用 {{count}}/{{max}} 个",
    "properties.showArchived": "显示已归档",
    "properties.newProperty": "新建属性",
    "properties.archivedBadge": "已归档",
    "properties.emptyTitle": "还没有属性",
    "properties.emptyDescription": "工作区自定义属性可让 issue 携带类型化字段，如单选、日期或数字。",
    "settings.propertiesTitle": "属性",
    "settings.propertiesSubtitle": "管理工作区的 issue 自定义属性",
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

  it("interpolates the usage-count and limit placeholders", () => {
    mod.setLocale("en");
    expect(mod.translate("properties.usageCount", { count: 3 })).toContain("3");
    expect(mod.translate("properties.limitHint", { count: 12, max: 20 })).toContain("12");
    mod.setLocale("zh");
    expect(mod.translate("properties.usageCount", { count: 3 })).toContain("3");
    expect(mod.translate("properties.limitHint", { count: 12, max: 20 })).toContain("12");
  });
});