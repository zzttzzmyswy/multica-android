import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-57 issue-create-settings i18n. Same
// contract as the other *-keys tests: every key resolves in BOTH locales
// and the zh value is actually translated (not the en text echoed back).
describe("issue-create-settings i18n", () => {
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
    "attr.status": "状态",
    "settings.issueTitle": "任务",
    "settings.issueSubtitle": "选择各创建方式工具栏常驻显示的字段。",
    "settings.issue.quickCreateTitle": "通过智能体创建",
    "settings.issue.manualCreateTitle": "手动创建",
    "settings.issue.fields.status": "状态",
    "settings.issue.fields.priority": "优先级",
    "settings.issue.fields.assignee": "负责人",
    "settings.issue.fields.project": "项目",
    "settings.issue.fields.dueDate": "截止日期",
    "settings.issue.customizeFields": "自定义字段",
    "newIssue.moreFieldsTitle": "更多字段",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en).not.toBe(key); // en present (not the raw id fallback)
      expect(en.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      const actualZh = mod.translate(key);
      expect(actualZh).toBe(zh); // zh present and translated
      expect(actualZh).not.toBe(en); // not the en text echoed back
      mod.setLocale("en");
    }
  });
});