import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n spot-checks for iteration 134 — the issue table's column resizing /
// column order menu, and the sub-issue preset chip on the new-issue form.
// Same contract as iter119/…/iter133-keys.test.ts: every key resolves in BOTH
// locales and the zh value is a real translation, not the raw-id fallback.
// (`lib/i18n/locale-completeness.test.ts` covers the "defined at all" half
// mechanically; this pins the wording that carries meaning the id cannot.)
describe("iteration 134 i18n", () => {
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
    // Column resize + order (column menu).
    "table.resetColumns": "恢复默认列",
    "a11y.tableResizeColumn": "调整{{column}}列宽",
    "a11y.tableMoveColumnUp": "把{{column}}列左移",
    "a11y.tableMoveColumnDown": "把{{column}}列右移",
    // Row-level "new sub-issue" entry + the preset chip it seeds.
    "a11y.tableCreateSubIssue": "为{{title}}新建子任务",
    "newIssue.parentChip": "{{identifier}} 的子任务",
    "newIssue.parentChipClear": "移除父任务",
  };

  it("resolves every new key in both locales, with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en, key).not.toBe(key);
      expect(en.length, key).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key), key).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("interpolates the column and issue names the new labels carry", () => {
    const resize = mod.translate("a11y.tableResizeColumn", { column: "状态" });
    expect(resize).toContain("状态");
    expect(resize).not.toContain("{{");
    const create = mod.translate("a11y.tableCreateSubIssue", {
      title: "修复登录",
    });
    expect(create).toContain("修复登录");
    expect(create).not.toContain("{{");
    const chip = mod.translate("newIssue.parentChip", { identifier: "MYS-1" });
    expect(chip).toContain("MYS-1");
    expect(chip).not.toContain("{{");
  });
});
