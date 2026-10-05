import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-195 write-failure copy.
//
// Same contract as every keys test: each key resolves in BOTH locales, the en
// value is the real string (not the raw-id fallback), and the zh value is the
// exact Chinese copy.
//
// These are the titles for the writes that used to fail silently. Every picker
// route now raises one of them from its `onError`, so a missing key would turn
// a reported failure back into a raw id on screen — which is only marginally
// better than the silence it replaced.
describe("write failure i18n", () => {
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
    "issueRelation.updateFailed": "更新任务失败",
    "issueRelation.addChildFailed": "添加子任务失败",
    "issueRelation.setParentFailed": "更新任务失败",
    "projects.updateFailed": "更新项目失败",
    "labels.attachFailed": "更新任务标签失败",
    "labels.createdFailed": "创建标签失败",
    "chat.projectUpdateFailed": "更新会话项目失败",
    "common.changeFailed": "修改未保存",
    "quickActions.updateFailed": "更新快捷操作失败",
    "repositories.removeFailed": "移除仓库失败",
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

  it("says the change did not land rather than that it is forbidden", () => {
    // The title is a factual claim about what happened, not a verdict on why.
    // A permissions or validation message arrives separately as the alert body
    // (the server's own text), so the title must stay true for every cause.
    for (const locale of ["en", "zh"] as const) {
      mod.setLocale(locale);
      for (const key of Object.keys(ZH_SPOT)) {
        const text = mod.translate(key);
        expect(text.toLowerCase()).not.toContain("forbidden");
        expect(text).not.toContain("禁止");
      }
    }
    mod.setLocale("en");
  });

  it("keeps the issue-update title distinct from the project-update title", () => {
    // They are different objects with different retry paths; a single shared
    // string would leave the user unable to tell which screen to revisit.
    mod.setLocale("zh");
    expect(mod.translate("issueRelation.updateFailed")).not.toBe(
      mod.translate("projects.updateFailed"),
    );
    mod.setLocale("en");
    expect(mod.translate("issueRelation.updateFailed")).not.toBe(
      mod.translate("projects.updateFailed"),
    );
  });
});
