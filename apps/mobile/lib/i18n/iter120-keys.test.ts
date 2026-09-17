import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n spot-checks for the iteration-120 project start/due date rows + skill
// UsedBy section. Same contract as iter119-keys.test.ts: every key resolves in
// BOTH locales (a zh value proves the en key is real, and vice versa) and the
// zh value is actually translated.
describe("project dates + skill usedBy i18n (MYS-1021)", () => {
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
    "projects.detail.startDate": "开始日期",
    "projects.detail.dueDate": "截止日期",
    "projects.detail.noStartDate": "无开始日期",
    "projects.detail.noDueDate": "无截止日期",
    "skills.usedBy.title": "被 {{count}} 个智能体使用",
    "skills.usedBy.titleOther": "被 {{count}} 个智能体使用",
    "skills.usedBy.empty":
      "还未分配给任何智能体。打开某个智能体的 Skills 标签页进行分配。",
    "skills.usedBy.add": "添加到智能体",
    "skills.usedBy.addTitle": "添加到智能体",
    "skills.usedBy.addDescription": "选择要获得所选 skill 的智能体。",
    "skills.usedBy.mine": "我的智能体",
    "skills.usedBy.others": "其他智能体",
    "skills.usedBy.addedOne": "已添加到 {{name}}",
    "skills.usedBy.addedMulti": "已添加到 {{count}} 个智能体",
    "skills.usedBy.addFailed": "添加 skill 失败",
    "skills.usedBy.noAgents": "没有可添加的智能体。",
    "skills.usedBy.noMatch": "没有匹配的智能体。",
    "skills.usedBy.searchPlaceholder": "搜索智能体",
  };

  it("resolves every new key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const enValue = mod.translate(key);
      expect(enValue, `en fallback leak: ${key}`).not.toBe(key);
      expect(enValue.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("interpolates the usedBy count in both locales", () => {
    mod.setLocale("en");
    expect(mod.translate("skills.usedBy.titleOther", { count: 3 })).toBe(
      "Used by 3 agents",
    );
    mod.setLocale("zh");
    expect(mod.translate("skills.usedBy.titleOther", { count: 3 })).toBe(
      "被 3 个智能体使用",
    );
  });

  it("interpolates the added toast name in both locales", () => {
    mod.setLocale("en");
    expect(mod.translate("skills.usedBy.addedOne", { name: "docs" })).toBe(
      "Added to docs",
    );
    mod.setLocale("zh");
    expect(mod.translate("skills.usedBy.addedOne", { name: "docs" })).toBe(
      "已添加到 docs",
    );
  });
});
