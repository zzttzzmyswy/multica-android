import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n spot-checks for iteration 175 — skill attached-file management, the
// shared avatar upload control, and the chat queue state. Same contract as
// skills-keys.test.ts / iter172-keys.test.ts: every key resolves in BOTH
// locales and the zh value is a real translation, not the raw-id fallback.
//
// The seven `add_file.errors.*` strings are copied verbatim from views'
// `skills.json` (`detail.add_file.errors.*`) — the same seven rejections the
// web add-file row shows. `chat.list.waiting` likewise matches views'
// `chat.json` (`list.waiting`), which zh-cross-bundle.test.ts holds to exact
// agreement.
describe("skill files / avatar upload / chat queue i18n (iteration 175)", () => {
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
    // Skill attached-file management.
    "skills.detail.add_file.newFile": "新建文件",
    "skills.detail.add_file.add": "添加",
    "skills.detail.add_file.cancel": "取消",
    "skills.detail.add_file.errors.empty": "路径不能为空。",
    "skills.detail.add_file.errors.absolute": "不允许绝对路径。",
    "skills.detail.add_file.errors.double_dot": '路径不能包含 ".."。',
    "skills.detail.add_file.errors.reserved": "SKILL.md 已为主文件保留。",
    "skills.detail.add_file.errors.exists": "该路径已存在文件。",
    "skills.detail.add_file.errors.is_directory": "已有同名文件夹",
    "skills.detail.add_file.errors.under_file": "该位置已被一个文件占用",
    "skills.detail.fileActions.rename": "重命名",
    "skills.detail.fileActions.delete": "删除",
    "skills.detail.saveBar.changed": "有未保存的文件变更",
    "skills.detail.saveBar.save": "保存修改",
    "skills.detail.saveBar.discard": "丢弃",
    "skills.detail.saveBar.saving": "保存中…",
    "skills.detail.saveBar.saved": "skill 附属文件已保存",
    "skills.detail.saveBar.saveFailed": "保存附属文件失败",
    // Shared avatar upload control + its three call sites.
    "avatar.takePhoto": "拍照",
    "avatar.chooseFromLibrary": "从相册选择",
    "avatar.removePhoto": "移除头像",
    "avatar.change": "更换头像",
    "avatar.cameraPermissionTitle": "需要权限",
    "avatar.cameraPermissionMessage": "需要相机权限才能拍摄照片。",
    "avatar.imageTooLargeTitle": "图片太大",
    "avatar.imageTooLargeMessage": "请选择 5 MB 以内的图片。",
    "avatar.uploadFailedTitle": "上传失败",
    "avatar.uploadFailedMessage": "无法上传头像。",
    "avatar.removeFailedTitle": "移除失败",
    "avatar.removeFailedMessage": "无法移除头像。",
    "workspaceSettings.logo": "工作区标志",
    "workspaceSettings.logoHint": "点击图标上传新图片",
    "workspaceSettings.logoUpdated": "工作区图标已更新",
    "workspaceSettings.logoUploadFailed": "上传工作区图标失败",
    "squads.detail.changeAvatar": "更换小队头像",
    "squads.detail.avatarUpdated": "小队头像已更新",
    "squads.new.avatar": "小队头像",
    // Chat session queue state.
    "chat.list.waiting": "等待回复",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en, `${key} (en)`).not.toBe(key);
      expect(en.length, `${key} (en)`).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key), `${key} (zh)`).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("interpolates the file-action path placeholder", () => {
    mod.setLocale("zh");
    expect(mod.translate("skills.detail.fileActions.label", { path: "run.sh" })).toBe(
      "run.sh 的操作",
    );
    mod.setLocale("en");
    expect(mod.translate("skills.detail.fileActions.label", { path: "run.sh" })).toBe(
      "Actions for run.sh",
    );
  });

  it("keeps the add-file placeholder identical in both locales", () => {
    // A path example, not prose — translating it would make the hint wrong.
    expect(mod.translate("skills.detail.add_file.placeholder")).toBe("templates/review.md");
    mod.setLocale("zh");
    expect(mod.translate("skills.detail.add_file.placeholder")).toBe("templates/review.md");
  });

  it("no longer carries the profile-scoped avatar keys", () => {
    // The avatar strings moved to `avatar.*` when the control was shared with
    // workspace settings and squads; a leftover copy would be a second source
    // of truth for the same sentence.
    for (const key of [
      "profile.takePhoto",
      "profile.chooseFromLibrary",
      "profile.removePhoto",
      "profile.cameraPermissionTitle",
      "profile.cameraPermissionMessage",
      "profile.imageTooLargeTitle",
      "profile.imageTooLargeMessage",
      "profile.uploadFailedTitle",
      "profile.uploadFailedMessage",
      "profile.removeFailedTitle",
      "profile.removeFailedMessage",
    ]) {
      expect(mod.translate(key), key).toBe(key); // raw-id fallback
    }
  });
});
