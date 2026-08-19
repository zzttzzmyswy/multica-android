import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-75 issue-tree editing i18n (MYS-493), the
// mobile mirror of web's modals.add_child / modals.set_parent /
// detail.section_parent_issue / actions.remove_parent_issue copy. Same
// contract as the other *-keys tests: every key resolves in BOTH locales
// and the zh value is actually translated.
describe("issue-tree relations i18n", () => {
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
    "issueRelation.parent": "父任务",
    "issueRelation.addChildTitle": "添加子任务",
    "issueRelation.addChildDescription": "搜索一个任务添加为子任务",
    "issueRelation.setParentTitle": "设置父任务",
    "issueRelation.setParentDescription": "搜索一个任务，将其设为当前任务的父级",
    "issueRelation.removeParentAction": "移除父任务",
    "issueRelation.updateFailed": "更新任务失败",
    "issueRelation.addChildFailed": "添加子任务失败",
    "issueRelation.setParentFailed": "更新任务失败",
    "issueRelation.searchPlaceholder": "搜索任务…",
    "issueRelation.searching": "搜索中…",
    "issueRelation.noResults": "未找到任务。",
    "issueRelation.promptToSearch": "输入关键词搜索任务",
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

  it("en copy mirrors web modals/actions wording", () => {
    expect(mod.translate("issueRelation.parent")).toBe("Parent issue");
    expect(mod.translate("issueRelation.addChildTitle")).toBe("Add sub-issue");
    expect(mod.translate("issueRelation.addChildDescription")).toBe(
      "Search for an issue to add as a sub-issue",
    );
    expect(mod.translate("issueRelation.setParentTitle")).toBe(
      "Set parent issue",
    );
    expect(mod.translate("issueRelation.setParentDescription")).toBe(
      "Search for an issue to set as the parent of this issue",
    );
    expect(mod.translate("issueRelation.removeParentAction")).toBe(
      "Remove parent issue",
    );
    expect(mod.translate("issueRelation.searchPlaceholder")).toBe(
      "Search issues…",
    );
    expect(mod.translate("issueRelation.promptToSearch")).toBe(
      "Type to search issues",
    );
  });
});