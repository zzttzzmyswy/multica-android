import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-62 issue-workbench filter/sort/group i18n
// (MYS-408). Same contract as every keys test: every key resolves in BOTH
// locales and the zh value is actually translated.
describe("issue filter/sort/group i18n", () => {
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
    "filter.assignee": "经办人",
    "filter.creator": "创建人",
    "filter.project": "项目",
    "filter.label": "标签",
    "filter.choose": "选择…",
    "filter.noAssignee": "未指派",
    "filter.noProject": "无项目",
    "filter.labelSearch": "搜索标签",
    "filter.sort.title": "排序方式",
    "filter.sort.asc": "升序",
    "filter.sort.desc": "降序",
    "filter.sort.position": "手动排序",
    "filter.sort.status": "状态",
    "filter.sort.priority": "优先级",
    "filter.sort.startDate": "开始日期",
    "filter.sort.dueDate": "截止日期",
    "filter.sort.createdAt": "创建日期",
    "filter.sort.updatedAt": "更新日期",
    "filter.sort.titleField": "标题",
    "filter.group.title": "分组方式",
    "filter.group.status": "按状态",
    "filter.group.assignee": "按经办人",
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
});