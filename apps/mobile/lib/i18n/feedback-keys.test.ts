import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-100 Help & Feedback page i18n (MYS-708).
// Same contract as every keys test: every key resolves in BOTH locales (a zh
// tag proves the en key is real, and vice versa), the zh value is actually
// translated, and the key SETS stay symmetric.
describe("feedback i18n", () => {
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
    "feedback.title",
    "feedback.entrySubtitle",
    "feedback.kindLabel",
    "feedback.kindBug",
    "feedback.kindFeature",
    "feedback.kindGeneral",
    "feedback.kindPraise",
    "feedback.placeholder",
    "feedback.messageHint",
    "feedback.attach",
    "feedback.uploading",
    "feedback.uploadFailed",
    "feedback.send",
    "feedback.sending",
    "feedback.toastTooLong",
    "feedback.toastTooMany",
    "feedback.toastSent",
    "feedback.toastFailed",
    "feedback.githubHintPrefix",
    "feedback.githubHintLink",
    "feedback.helpSectionLabel",
    "feedback.helpDocs",
    "feedback.helpChangelog",
    "feedback.helpDiscord",
    "feedback.serverVersion",
  ];

  const ZH_SPOT: Record<string, string> = {
    "feedback.title": "帮助与反馈",
    "feedback.kindBug": "Bug",
    "feedback.kindFeature": "功能建议",
    "feedback.kindPraise": "好评",
    "feedback.kindGeneral": "一般反馈",
    "feedback.send": "发送反馈",
    "feedback.sending": "发送中...",
    "feedback.toastSent": "感谢反馈！",
    "feedback.toastFailed": "发送反馈失败",
    "feedback.toastTooLong": "内容过长",
    "feedback.helpDocs": "文档",
    "feedback.helpChangelog": "更新日志",
    "feedback.helpDiscord": "Discord",
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

  it("interpolates the server version into the version row in both locales", () => {
    mod.setLocale("en");
    expect(mod.translate("feedback.serverVersion", { version: "v1.2.3" })).toBe(
      "Server version v1.2.3",
    );
    mod.setLocale("zh");
    expect(
      mod.translate("feedback.serverVersion", { version: "v1.2.3" }),
    ).toBe("服务器版本 v1.2.3");
  });
});