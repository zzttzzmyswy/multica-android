import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-69 table-view i18n (MYS-440). Same contract
// as every keys test: every key resolves in BOTH locales and the zh value is
// actually translated.
describe("issue table view i18n", () => {
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
    "issues.viewTable": "表格",
    "a11y.viewTable": "表格视图",
    "a11y.tableSelectAll": "全选可见问题",
    "a11y.tableSortColumn": "按此列排序",
    "a11y.tableSortTitle": "按标题排序",
    "a11y.tableRowSelect": "选择",
    "table.column.title": "标题",
    "table.column.identifier": "编号",
    "table.column.status": "状态",
    "table.column.priority": "优先级",
    "table.column.assignee": "负责人",
    "table.column.labels": "标签",
    "table.column.project": "项目",
    "table.column.startDate": "开始日期",
    "table.column.dueDate": "截止日期",
    "table.column.createdAt": "创建时间",
    "table.column.updatedAt": "更新时间",
    "table.column.creator": "创建者",
    "table.column.property": "属性",
    "table.column.unknown": "列",
    "table.columns": "列",
    "table.columnsTitle": "列设置",
    "table.columnsSystem": "系统列",
    "table.columnsProperties": "自定义属性",
    "table.export": "导出",
    "table.exportTitle": "导出表格",
    "table.exportAll": "导出全部",
    "table.exportSelected": "导出选中（{{count}}）",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en).not.toBe(key); // en present (not the raw id fallback)
      expect(en.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      const zhValue = mod.translate(key);
      expect(zhValue).toBe(zh); // zh spot matches
      mod.setLocale("en");
    }
  });

  it("interpolates the selected-count param", () => {
    const en = mod.translate("table.exportSelected", { count: 3 });
    expect(en).toContain("3");
    expect(en).not.toContain("{{count}}");
    mod.setLocale("zh");
    const zh = mod.translate("table.exportSelected", { count: 3 });
    expect(zh).toContain("3");
  });
});