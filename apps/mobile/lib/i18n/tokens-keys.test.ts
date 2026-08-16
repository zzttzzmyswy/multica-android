import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Iteration-38 API Tokens i18n. Same contract as members-keys.test.ts: every
// key resolves in BOTH locales and the zh value is actually translated.
describe("tokens i18n", () => {
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
    "screen.tokens": "API Tokens",
    "settings.apiTokens": "API Tokens",
    "settings.apiTokensSub": "供 CLI 与外部集成身份验证使用的个人访问令牌",
    "tokens.title": "API Token",
    "tokens.description":
      "个人访问令牌让 CLI 和外部集成可以代表你的账号进行身份验证。可通过 multica login --token 使用，或在调用 API 时作为 Bearer 令牌发送。",
    "tokens.securityNote": "令牌拥有你账号的完整访问权限，请像密码一样妥善保管。",
    "tokens.empty": "还没有 API token。在上方创建一个即可开始使用。",
    "tokens.loadFailed": "无法加载 API token，请重试。",
    "tokens.namePlaceholder": "Token 名称（例如：我的 CLI）",
    "tokens.expiry30": "30 天",
    "tokens.expiry90": "90 天",
    "tokens.expiry365": "1 年",
    "tokens.expiryNever": "永不过期",
    "tokens.create": "创建",
    "tokens.creating": "创建中...",
    "tokens.loadFailedTitle": "加载 token 失败",
    "tokens.createFailedTitle": "创建 token 失败",
    "tokens.revokedTitle": "已吊销 token",
    "tokens.revokeFailedTitle": "吊销 token 失败",
    "tokens.createdWithDate": "创建于 {{date}}",
    "tokens.lastUsedWithDate": "最后使用 {{date}}",
    "tokens.lastUsedNever": "从未使用",
    "tokens.expiresWithDate": "{{date}} 过期",
    "tokens.revoke": "吊销",
    "tokens.revokeConfirmTitle": "吊销 token",
    "tokens.revokeConfirmMessage": "该 token 将被永久吊销且不再可用。此操作不可撤销。",
    "tokens.revokeCancel": "取消",
    "tokens.createdTitle": "个人访问 token 已创建",
    "tokens.createdWarningEmphasis": "仅显示一次",
    "tokens.createdConfirmStored": "我已妥善保存该 token。",
    "tokens.createdCopyToken": "复制 token",
    "tokens.createdCliHint": "使用以下命令登录 CLI：",
    "tokens.createdCopyCommand": "复制命令",
    "tokens.createdDone": "完成",
  };

  it("resolves every token key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en).not.toBe(key);
      expect(en.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("interpolates the last-used placeholder", () => {
    mod.setLocale("zh");
    expect(
      mod.translate("tokens.lastUsedWithDate", { date: "Aug 10" }),
    ).toBe("最后使用 Aug 10");
    mod.setLocale("en");
    expect(
      mod.translate("tokens.lastUsedWithDate", { date: "Aug 10" }),
    ).toBe("Last used Aug 10");
  });
});