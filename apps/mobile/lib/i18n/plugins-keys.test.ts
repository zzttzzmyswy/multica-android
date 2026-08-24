import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-99 Plugins management i18n (MYS-700).
// Same contract as every keys test: every key resolves in BOTH locales (a zh
// tag proves the en key is real, and vice versa), the zh value is actually
// translated, and the key SETS stay symmetric.
describe("plugins management i18n", () => {
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
    "plugins.title",
    "plugins.description",
    "plugins.loading",
    "plugins.loadFailed",
    "plugins.loadFailedDescription",
    "plugins.backendUnavailable",
    "plugins.backendUnavailableDescription",
    "plugins.catalogDegraded",
    "plugins.catalogDegradedDescription",
    "plugins.readOnly",
    "plugins.readOnlyDescription",
    "plugins.empty",
    "plugins.official",
    "plugins.private",
    "plugins.unverified",
    "plugins.signed",
    "plugins.signatureUnverified",
    "plugins.incompatible",
    "plugins.incompatibleDescription",
    "plugins.installDisabledHint",
    "plugins.install",
    "plugins.installSuccess",
    "plugins.activeVersion",
    "plugins.health",
    "plugins.bindings",
    "plugins.unknownAgent",
    "plugins.unknownMember",
    "plugins.workspaceScope",
    "plugins.agentScope",
    "plugins.bindingDisabled",
    "plugins.disableBinding",
    "plugins.noBindings",
    "plugins.enableScope",
    "plugins.enabled",
    "plugins.disableWorkspace",
    "plugins.disabled",
    "plugins.upgraded",
    "plugins.rolledBack",
    "plugins.source",
    "plugins.privateUpload",
    "plugins.uploadedBy",
    "plugins.uninstall",
    "plugins.uninstalled",
    "plugins.upgradeTo",
    "plugins.rollbackTo",
    "plugins.actionFailed",
    "plugins.reviewContributes",
    "plugins.reviewPermissions",
    "plugins.reviewCompatibility",
    "plugins.reviewHostApi",
    "plugins.reviewPublisher",
    "plugins.reviewNone",
    "plugins.stateDisabled",
    "plugins.stateActivating",
    "plugins.stateHealthy",
    "plugins.stateDegraded",
    "plugins.stateFailed",
    "plugins.confirmUninstallTitle",
    "plugins.confirmUninstallMessage",
    "plugins.versions",
    "plugins.installVersion",
  ];

  const ZH_SPOT: Record<string, string> = {
    "plugins.title": "插件",
    "plugins.install": "安装",
    "plugins.uninstall": "卸载",
    "plugins.workspaceScope": "工作区",
    "plugins.agentScope": "智能体",
    "plugins.stateHealthy": "健康",
    "plugins.stateDisabled": "已禁用",
    "plugins.official": "官方",
    "plugins.private": "私有",
    "plugins.disableBinding": "禁用",
    "plugins.enableScope": "启用作用域",
    "plugins.confirmUninstallTitle": "卸载插件？",
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

  it("interpolates version/name into action strings in both locales", () => {
    mod.setLocale("en");
    expect(mod.translate("plugins.upgradeTo", { version: "1.2.0" })).toBe(
      "Upgrade to v1.2.0",
    );
    expect(
      mod.translate("plugins.confirmUninstallMessage", { name: "Acme" }),
    ).toBe(
      "This removes Acme. Runs already using it are unaffected, but new runs can no longer use it.",
    );

    mod.setLocale("zh");
    expect(mod.translate("plugins.upgradeTo", { version: "1.2.0" })).toBe(
      "升级到 v1.2.0",
    );
    expect(
      mod.translate("plugins.installVersion", { version: "1.0.0" }),
    ).toBe("安装 v1.0.0");
  });
});