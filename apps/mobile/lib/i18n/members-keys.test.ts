import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-26 members list/detail i18n. Same contract as
// agents-keys.test.ts: every key resolves in BOTH locales (a zh tag proves
// the en key is real, and vice versa) and the zh value is actually translated.
describe("members list/detail i18n", () => {
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
    "nav.members": "成员",
    "screen.members": "成员",
    "members.loadError": "加载成员失败：",
    "members.emptyTitle": "还没有成员",
    "members.emptyDescription": "在 Web 端添加的成员会显示在这里。",
    "members.role.owner": "所有者",
    "members.role.admin": "管理员",
    "members.role.member": "成员",
    "members.joinedAt": "加入于 {{time}}",
    "members.sectionTitle": "成员（{{count}}）",
    "members.detail.role": "角色",
    "members.detail.joined": "加入时间",
    "members.detail.profile": "基本信息",
    "members.detail.manage": "管理",
    "members.detail.changeRole": "更改角色",
    "members.detail.removeAction": "从工作区移除",
    "members.detail.removeTitle": "移除 {{name}}",
    "members.detail.removeMessage": "从 {{workspace}} 中移除 {{name}}？该成员将失去对该工作区的访问权限。",
    "members.detail.roleUpdated": "已更新角色",
    "members.detail.roleUpdateFailed": "更新成员失败",
    "members.detail.removeFailed": "移除成员失败",
    "members.inviteTitle": "邀请新成员",
    "members.inviteEmailPlaceholder": "邮箱地址",
    "members.inviteRole": "角色",
    "members.inviteButton": "发送邀请",
    "members.inviting": "发送中…",
    "members.inviteEmailInvalid": "请输入有效的邮箱地址",
    "members.inviteSuccess": "邀请已发送",
    "members.inviteFailed": "发送邀请失败",
    "members.pendingTitle": "待处理邀请（{{count}}）",
    "members.pending": "待处理",
    "members.pendingExpiresAt": "{{time}} 过期",
    "members.pendingExpired": "已过期",
    "members.revokeTooltip": "撤销邀请",
    "members.revokeTitle": "撤销邀请？",
    "members.revokeMessage": "撤销发送给 {{email}} 的邀请？",
    "members.revokeAction": "撤销",
    "members.revoked": "邀请已撤销",
    "members.revokeFailed": "撤销邀请失败",
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

  it("interpolates the joined-time placeholder", () => {
    mod.setLocale("zh");
    expect(mod.translate("members.joinedAt", { time: "3d ago" })).toContain(
      "3d ago",
    );
  });

  it("interpolates the remove-title placeholder", () => {
    mod.setLocale("en");
    expect(mod.translate("members.detail.removeTitle", { name: "Ada" })).toContain(
      "Ada",
    );
  });
});