import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-33 about page + GitHub release update i18n.
// Same contract as runtimes-keys.test.ts: every key resolves in BOTH locales
// and the zh value is actually translated (not the en text echoed back).
describe("about i18n", () => {
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
    "nav.about": "关于",
    "screen.about": "关于",
    "about.subtitle": "安卓客户端",
    "about.versionLabel": "版本",
    "about.buildLabel": "构建号",
    "about.intro": "随时随地查看你的工作区、issue 与 agents。",
    "about.sourceCode": "源代码",
    "about.checkForUpdates": "检查更新",
    "about.checking": "正在检查…",
    "about.idle": "从 GitHub 检查是否有新版本。",
    "about.upToDate": "当前已是最新版本。",
    "about.latestVersion": "最新版本：v{{version}}",
    "about.updateAvailable": "发现新版本 v{{version}}。",
    "about.downloadAndInstall": "下载并安装",
    "about.downloading": "正在下载…",
    "update.hasNew": "有新版本",
    "update.installUnknownSourcesHint": "若安装被系统阻止，请允许此应用“安装未知应用”。",
    "update.openSettings": "打开设置",
    "update.error.network": "无法连接更新服务器，请稍后重试。",
    "update.error.noAsset": "当前设备架构暂未发布安装包。",
    "update.error.downloadFailed": "下载失败：{{message}}",
    "update.error.installFailed": "安装失败，请检查“安装未知应用”权限后重试。",
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

  it("substitutes template params in both locales", () => {
    expect(mod.translate("about.updateAvailable", { version: "0.2.0" })).toBe(
      "New version v0.2.0 is available.",
    );
    mod.setLocale("zh");
    expect(mod.translate("about.updateAvailable", { version: "0.2.0" })).toBe(
      "发现新版本 v0.2.0。",
    );
    mod.setLocale("en");
  });
});