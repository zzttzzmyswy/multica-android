import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-81 skill file editing + remote refresh i18n
// (MYS-591). Same contract as agents-env-keys.test.ts: every key resolves in
// BOTH locales, the zh value is actually translated, the key SETS stay
// symmetric, and interpolated placeholders render into real text.
describe("skill file editor + refresh i18n", () => {
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
    // file tree + refresh entry
    "skills.detail.mainFile",
    "skills.detail.primary",
    "skills.detail.readOnly",
    "skills.detail.refresh",
    "skills.detail.refreshConfirmTitle",
    "skills.detail.refreshConfirmBody",
    "skills.detail.refreshConfirmWarning",
    "skills.detail.refreshing",
    "skills.detail.refreshSuccess",
    "skills.detail.refreshFailed",
    // file editor
    "skills.editor.editFile",
    "skills.editor.preview",
    "skills.editor.raw",
    "skills.editor.save",
    "skills.editor.discard",
    "skills.editor.dirty",
    "skills.editor.saved",
    "skills.editor.discarded",
    "skills.editor.saveFailed",
    "skills.editor.conflictServerUpdated",
    "skills.editor.conflictBody",
    "skills.editor.conflictUseServer",
    "skills.editor.conflictOverwrite",
    "skills.editor.markdownPlaceholder",
    "skills.editor.rawPlaceholder",
    "skills.editor.noContent",
  ];

  const ZH_SPOT: Record<string, string> = {
    "skills.detail.mainFile": "主文件",
    "skills.detail.primary": "主文件",
    "skills.detail.refresh": "从远程刷新",
    "skills.detail.refreshConfirmTitle": "从来源更新这个 skill？",
    "skills.detail.refreshing": "刷新中...",
    "skills.detail.refreshFailed": "刷新失败",
    "skills.detail.readOnly": "只读",
    "skills.editor.editFile": "编辑文件",
    "skills.editor.preview": "预览",
    "skills.editor.raw": "纯文本",
    "skills.editor.save": "保存",
    "skills.editor.discard": "放弃修改",
    "skills.editor.dirty": "有未保存的修改",
    "skills.editor.saved": "文件已保存",
    "skills.editor.discarded": "已放弃修改",
    "skills.editor.saveFailed": "保存失败",
    "skills.editor.conflictServerUpdated": "该文件已在其他位置更新",
    "skills.editor.conflictUseServer": "采用服务器版",
    "skills.editor.conflictOverwrite": "覆盖",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const key of KEYS) {
      const en = mod.translate(key);
      expect(en).not.toBe(key); // en present (not the raw id fallback)
      expect(en.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      const zh = mod.translate(key);
      expect(zh.length).toBeGreaterThan(0);
      expect(zh).not.toBe(key);
      if (key in ZH_SPOT) {
        expect(zh).toBe(ZH_SPOT[key]);
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

  it("interpolates name/source into the refresh confirm + success in both locales", () => {
    const params = { name: "my-skill", source: "GitHub" };
    mod.setLocale("en");
    expect(mod.translate("skills.detail.refreshConfirmBody", params)).toContain(
      '"my-skill"',
    );
    expect(mod.translate("skills.detail.refreshConfirmBody", params)).toContain(
      "GitHub",
    );
    expect(mod.translate("skills.detail.refreshSuccess", { source: "GitHub" })).toBe(
      "Skill updated from GitHub",
    );

    mod.setLocale("zh");
    const zhBody = mod.translate("skills.detail.refreshConfirmBody", params);
    expect(zhBody).toContain("my-skill");
    expect(zhBody).toContain("GitHub");
    expect(mod.translate("skills.detail.refreshSuccess", { source: "GitHub" })).toBe(
      "已从 GitHub 更新技能",
    );
  });
});