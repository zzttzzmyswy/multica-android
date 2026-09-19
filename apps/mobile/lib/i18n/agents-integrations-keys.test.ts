import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-98 agent integrations i18n (MYS-699).
// Same contract as every keys test: every key resolves in BOTH locales (a zh
// tag proves the en key is real, and vice versa), the zh value is actually
// translated, and the key SETS stay symmetric.
describe("agents integrations i18n", () => {
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
    "agents.detail.menu.integrations",
    "agents.integrations.title",
    "agents.integrations.intro",
    "agents.integrations.membersNote",
    "agents.integrations.readonlyHint",
    "agents.integrations.larkName",
    "agents.integrations.slackName",
    "agents.integrations.dingtalkName",
    "agents.integrations.wecomName",
    "agents.integrations.larkDescription",
    "agents.integrations.slackDescription",
    "agents.integrations.dingtalkDescription",
    "agents.integrations.wecomDescription",
    "agents.integrations.statusActive",
    "agents.integrations.statusRevoked",
    "agents.integrations.larkRegionFeishu",
    "agents.integrations.larkRegionLark",
    "agents.integrations.botIdLabel",
    "agents.integrations.teamIdLabel",
    "agents.integrations.installedByLabel",
    "agents.integrations.installedAtLabel",
    "agents.integrations.configureMissing",
    "agents.integrations.comingSoon",
    "agents.integrations.bindInBrowser",
    "agents.integrations.openError",
    // Iteration 170 — the bind / disconnect write paths.
    "agents.integrations.larkBind",
    "agents.integrations.larkChooseRegion",
    "agents.integrations.larkDialogTitleFeishu",
    "agents.integrations.larkDialogTitleLark",
    "agents.integrations.larkDialogDescription",
    "agents.integrations.larkStarting",
    "agents.integrations.larkOpenLinkFeishu",
    "agents.integrations.larkOpenLinkLark",
    "agents.integrations.larkCopyLink",
    "agents.integrations.larkLinkCopied",
    "agents.integrations.larkOpenLinkFailed",
    "agents.integrations.larkWaiting",
    "agents.integrations.larkSuccess",
    "agents.integrations.larkRetry",
    "agents.integrations.larkClose",
    "agents.integrations.larkErrorExpired",
    "agents.integrations.larkErrorAccessDenied",
    "agents.integrations.larkErrorProtocol",
    "agents.integrations.larkErrorBotInfo",
    "agents.integrations.larkErrorConflict",
    "agents.integrations.larkErrorInstallerBind",
    "agents.integrations.larkErrorSessionLost",
    "agents.integrations.larkErrorForbidden",
    "agents.integrations.larkErrorGeneric",
    "agents.integrations.slackBind",
    "agents.integrations.dingtalkBind",
    "agents.integrations.wecomBind",
    "agents.integrations.byoCancel",
    "agents.integrations.byoRequired",
    "agents.integrations.byoSlackTitle",
    "agents.integrations.byoSlackDescription",
    "agents.integrations.byoSlackBotLabel",
    "agents.integrations.byoSlackBotPlaceholder",
    "agents.integrations.byoSlackBotHint",
    "agents.integrations.byoSlackBotPrefix",
    "agents.integrations.byoSlackAppLabel",
    "agents.integrations.byoSlackAppPlaceholder",
    "agents.integrations.byoSlackAppHint",
    "agents.integrations.byoSlackAppPrefix",
    "agents.integrations.byoSlackSubmit",
    "agents.integrations.byoDingTalkTitle",
    "agents.integrations.byoDingTalkDescription",
    "agents.integrations.byoDingTalkClientIdLabel",
    "agents.integrations.byoDingTalkClientIdPlaceholder",
    "agents.integrations.byoDingTalkClientSecretLabel",
    "agents.integrations.byoDingTalkClientSecretPlaceholder",
    "agents.integrations.byoDingTalkSubmit",
    "agents.integrations.byoWecomTitle",
    "agents.integrations.byoWecomDescription",
    "agents.integrations.byoWecomBotIdLabel",
    "agents.integrations.byoWecomBotIdPlaceholder",
    "agents.integrations.byoWecomSecretLabel",
    "agents.integrations.byoWecomSecretPlaceholder",
    "agents.integrations.byoWecomBotNameLabel",
    "agents.integrations.byoWecomBotNamePlaceholder",
    "agents.integrations.byoWecomBotNameHint",
    "agents.integrations.byoWecomSubmit",
    "agents.integrations.disconnect",
    "agents.integrations.disconnectTitle",
    "agents.integrations.disconnectDesc",
    "agents.integrations.disconnectConfirm",
    "agents.integrations.disconnectFailed",
  ];

  const ZH_SPOT: Record<string, string> = {
    "agents.detail.menu.integrations": "渠道绑定",
    "agents.integrations.title": "渠道绑定",
    "agents.integrations.statusActive": "已连接",
    "agents.integrations.statusRevoked": "已撤销",
    "agents.integrations.larkRegionFeishu": "飞书",
    "agents.integrations.larkRegionLark": "Lark",
    "agents.integrations.botIdLabel": "机器人 ID",
    "agents.integrations.teamIdLabel": "团队 ID",
    "agents.integrations.installedByLabel": "安装者",
    "agents.integrations.installedAtLabel": "安装时间",
    "agents.integrations.bindInBrowser": "在浏览器中绑定",
    // Iteration 170 spot checks — one per flow, so a future edit that swaps
    // the zh for the en string is caught rather than silently shipped.
    "agents.integrations.larkBind": "连接飞书机器人",
    // The Latin name keeps its space ("连接 Slack"); a shared "{channel}"
    // template could not do that and the CJK names at once.
    "agents.integrations.slackBind": "连接 Slack",
    "agents.integrations.dingtalkBind": "连接钉钉机器人",
    "agents.integrations.wecomBind": "连接企业微信机器人",
    "agents.integrations.larkChooseRegion": "选择飞书版本",
    "agents.integrations.larkErrorExpired": "链接在授权前已过期，请重新发起。",
    "agents.integrations.disconnect": "断开连接",
    "agents.integrations.byoRequired": "此项为必填。",
    "agents.integrations.byoSlackBotPrefix": "机器人令牌以 xoxb- 开头。",
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

  // Caught on device (iteration 170): the bind CTA rendered the literal
  // "连接{channel}" because the strings used single braces while translate()
  // substitutes `{{name}}`. A single-braced placeholder is silently inert —
  // it renders as text — so assert the doubled form on the keys that take
  // one, and that substituting actually changes the output.
  it("interpolates the placeholders it declares", () => {
    const PLACEHOLDERS: Record<string, Record<string, string>> = {
      "agents.integrations.disconnectTitle": { channel: "Slack" },
      "agents.integrations.disconnectFailed": { message: "boom" },
    };
    for (const [key, params] of Object.entries(PLACEHOLDERS)) {
      for (const locale of ["en", "zh"] as const) {
        mod.setLocale(locale);
        const raw = mod.translate(key);
        for (const name of Object.keys(params)) {
          expect(raw).toContain(`{{${name}}}`);
          // A stray single-brace form would render verbatim.
          expect(raw).not.toMatch(new RegExp(`(?<!\\{)\\{${name}\\}(?!\\})`));
        }
        const filled = mod.translate(key, params);
        expect(filled).not.toContain("{{");
        for (const value of Object.values(params)) {
          expect(filled).toContain(value);
        }
      }
    }
    mod.setLocale("en");
  });
});