import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n spot-check for the unreachable-custom-server recovery path (MYS-1146).
// Same contract as the other *-keys.test.ts suites: every key resolves in
// BOTH locales and the zh value is a real translation, not the raw-id
// fallback. The copy is what makes the recovery action trustworthy, so pin
// the parts that carry the meaning the id cannot: which host failed, and
// that the action is a reset rather than a "retry".
describe("unreachable-server recovery i18n", () => {
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
    "login.offlineCustomServer":
      "正在使用自定义服务器 {{url}}，该地址当前无法连接。可切回默认服务器。",
    "login.useDefaultServer": "重置为默认",
    "login.switchingServer": "切换中…",
  };

  it("resolves every recovery key in both locales", () => {
    for (const key of Object.keys(ZH_SPOT)) {
      expect(mod.translate(key), `en fallback leak: ${key}`).not.toBe(key);
      expect(mod.translate(key).length).toBeGreaterThan(0);
    }
    mod.setLocale("zh");
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      expect(mod.translate(key), `zh mismatch: ${key}`).toBe(zh);
    }
  });

  it("names the unreachable host in the message", () => {
    expect(
      mod.translate("login.offlineCustomServer", {
        url: "https://api.mu.zztweb.top",
      }),
    ).toContain("https://api.mu.zztweb.top");
    mod.setLocale("zh");
    expect(
      mod.translate("login.offlineCustomServer", {
        url: "https://api.mu.zztweb.top",
      }),
    ).toContain("https://api.mu.zztweb.top");
  });

  it("labels the action as a reset, not a retry", () => {
    // The affordance changes which server the app talks to; wording it as a
    // retry would hide that and invite the user to tap it blindly.
    for (const locale of ["en", "zh"] as const) {
      mod.setLocale(locale);
      const reset = mod.translate("login.useDefaultServer");
      expect(reset).not.toBe(mod.translate("common.retry"));
      expect(reset).not.toBe(mod.translate("common.save"));
    }
  });
});
