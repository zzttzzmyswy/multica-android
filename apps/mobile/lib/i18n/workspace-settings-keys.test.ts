import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-30 workspace-settings i18n. Same contract as
// members-keys.test.ts: every key resolves in BOTH locales and the zh value
// is actually translated.
describe("workspace settings i18n", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  async function loadI18n() {
    return await import("./index");
  }

  beforeEach(async () => {
    mod = await loadI18n();
    mod.resetI18nForTests();
    mod.setLocale("en");
  });

  const ZH_SPOT: Record<string, string> = {
    "screen.workspaceSettings": "工作区设置",
    "workspaceSettings.saved": "已保存",
    "workspaceSettings.saveFailed": "保存失败",
    "workspaceSettings.name": "名称",
    "workspaceSettings.nameRequired": "名称不能为空",
    "workspaceSettings.description": "描述",
    "workspaceSettings.descriptionPlaceholder": "添加简短描述…",
    "workspaceSettings.save": "保存",
    "workspaceSettings.saving": "保存中…",
    "workspaceSettings.info": "工作区信息",
    "workspaceSettings.slug": "标识",
    "workspaceSettings.issuePrefix": "问题前缀",
    "workspaceSettings.createdAt": "创建时间",
    "workspaceSettings.dangerZone": "危险区",
    "workspaceSettings.leaveTitle": "退出工作区",
    "workspaceSettings.leaveConfirmTitle": "退出「{{name}}」？",
    "workspaceSettings.leaveButton": "退出",
    "workspaceSettings.leaving": "退出中…",
    "workspaceSettings.leaveFailed": "退出工作区失败",
    "workspaceSettings.deleteTitle": "删除工作区",
    "workspaceSettings.deleteButton": "删除",
    "workspaceSettings.deleting": "删除中…",
    "workspaceSettings.deleteFailed": "删除工作区失败",
    "workspaceSettings.deleteModalTitle": "删除工作区？",
    "workspaceSettings.typeToConfirmPrefix": "输入",
    "workspaceSettings.deleteConfirm": "删除",
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

  it("interpolates the leave-confirm name placeholder", () => {
    mod.setLocale("zh");
    expect(
      mod.translate("workspaceSettings.leaveConfirmTitle", { name: "Acme" }),
    ).toBe("退出「Acme」？");
    mod.setLocale("en");
    expect(
      mod.translate("workspaceSettings.leaveConfirmTitle", { name: "Acme" }),
    ).toBe("Leave Acme?");
  });
});