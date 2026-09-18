import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n spot-checks for iteration 132 — the issue table's inline cell editing
// + parent/child collapse, and the add-resource repository list. Same
// contract as iter119/…/iter131-keys.test.ts: every key resolves in BOTH
// locales and the zh value is a real translation, not the raw-id fallback.
// (`lib/i18n/locale-completeness.test.ts` covers the "defined at all" half
// mechanically; this pins the wording that carries meaning the id cannot.)
describe("iteration 132 i18n", () => {
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
    // Table hierarchy (collapse chevron + indented titles).
    "a11y.tableCollapseRow": "收起子任务",
    "a11y.tableExpandRow": "展开子任务",
    // Table inline editing — the cell's a11y label and the title rename
    // dialog web calls InlineTitle.
    "a11y.tableEditCell": "编辑{{column}}",
    "a11y.tableOpenRow": "打开任务",
    "a11y.tableRenameHint": "双击重命名",
    "table.renameTitle": "重命名任务",
    "table.renamePlaceholder": "任务标题",
    // Add-resource repository list (web project-resources-section popover).
    "resource.fromRepositories": "工作区仓库",
    "resource.searchRepositories": "搜索仓库",
    "resource.noRepositoryMatch": "没有匹配的仓库。",
    "resource.attachedBadge": "已挂载",
    "resource.manualEntry": "或手动填写 URL",
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

  it("interpolates the column name into the edit-cell label", () => {
    const en = mod.translate("a11y.tableEditCell", { column: "Status" });
    expect(en).toContain("Status");
    expect(en).not.toContain("{{column}}");
    mod.setLocale("zh");
    const zh = mod.translate("a11y.tableEditCell", { column: "状态" });
    expect(zh).toContain("状态");
    expect(zh).not.toContain("{{column}}");
  });
});
