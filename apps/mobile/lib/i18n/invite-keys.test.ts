import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Iteration-54 invitation accept-flow i18n. Same contract as
// members-keys.test.ts: every key resolves in BOTH locales and the zh values
// are real translations.
async function loadI18n() {
  return await import("./index");
}

describe("invite accept-flow i18n", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  beforeEach(async () => {
    mod = await loadI18n();
    mod.resetI18nForTests();
    mod.setLocale("en");
  });

  const ZH_SPOT: Record<string, string> = {
    "invite.notFoundTitle": "未找到邀请",
    "invite.notFoundDesc": "此邀请可能已过期、已被撤销，或不属于你的账号。",
    "invite.acceptedTitle": "你已加入 {{workspace_name}}！",
    "invite.redirecting": "正在跳转到工作区...",
    "invite.declinedTitle": "已拒绝邀请",
    "invite.declinedDesc": "你将不会加入此工作区。",
    "invite.joinTitle": "加入 {{workspace_name}}",
    "invite.fallbackWorkspaceName": "工作区",
    "invite.invitedRoleAdmin": "邀请你以管理员身份加入。",
    "invite.invitedRoleMember": "邀请你以成员身份加入。",
    "invite.alreadyHandledAccepted": "此邀请已被接受。",
    "invite.alreadyHandledDeclined": "此邀请已被拒绝。",
    "invite.expired": "此邀请已过期。",
    "invite.decline": "拒绝",
    "invite.declining": "拒绝中...",
    "invite.accept": "接受并加入",
    "invite.joining": "加入中...",
    "invite.acceptFailed": "接受邀请失败",
    "invite.declineFailed": "拒绝邀请失败",
    "invite.pendingTitle": "待处理邀请",
    "invite.pendingJoin": "加入",
    "invite.errorTitle": "出错了",
    "invite.signOut": "退出登录",
    "invite.back": "返回",
  };

  it("resolves every invite key in both locales", () => {
    for (const key of Object.keys(ZH_SPOT)) {
      expect(mod.translate(key, {})).toBeTruthy();
      expect(mod.translate(key, {})).not.toBe(key);
    }
  });

  it("has real zh translations (spot values)", () => {
    mod.setLocale("zh");
    for (const [key, value] of Object.entries(ZH_SPOT)) {
      expect(mod.translate(key, {})).toBe(value);
    }
  });
});