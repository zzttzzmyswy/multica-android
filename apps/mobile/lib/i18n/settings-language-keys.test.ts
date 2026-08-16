import { beforeEach, describe, expect, it, vi } from "vitest";
import * as SecureStore from "expo-secure-store";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Iteration-39 Settings language preference i18n + saved-override accessor.
// Same contract as tokens-keys.test.ts: every key resolves in BOTH locales,
// zh values are translated, and the locale override state machine is exact.
async function loadI18n() {
  return await import("./index");
}

describe("settings language i18n", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  beforeEach(async () => {
    mod = await loadI18n();
    mod.resetI18nForTests();
    mod.setLocale("en");
  });

  const ZH_SPOT: Record<string, string> = {
    "settings.language": "语言",
    "settings.languageSystem": "跟随系统",
    "settings.languageZh": "中文",
    "settings.languageEn": "English",
    "settings.languageSyncFailed": "语言偏好已在本机生效，但同步到服务器失败。",
  };

  it("resolves every language key in both locales", () => {
    const zh = mod.translate;
    for (const key of Object.keys(ZH_SPOT)) {
      expect(zh(key, {})).toBeTruthy();
      expect(zh(key, {})).not.toBe(key);
      expect(mod.translate(key, {})).toBeTruthy();
    }
  });

  it("has real zh translations (spot values)", () => {
    mod.setLocale("zh");
    for (const [key, value] of Object.entries(ZH_SPOT)) {
      expect(mod.translate(key, {})).toBe(value);
    }
  });
});

describe("getSavedLocaleOverride state machine", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  beforeEach(async () => {
    mod = await loadI18n();
    mod.resetI18nForTests();
  });

  it("starts null when the user has never pinned a language", () => {
    expect(mod.getSavedLocaleOverride()).toBeNull();
  });

  it("tracks setLocale so settings shows the pinned option", () => {
    mod.setLocale("zh");
    expect(mod.getSavedLocaleOverride()).toBe("zh");
    expect(mod.getCurrentLocale()).toBe("zh");
  });

  it("clears the override on resetLocale (follow device)", async () => {
    mod.setLocale("zh");
    await mod.resetLocale();
    expect(mod.getSavedLocaleOverride()).toBeNull();
  });

  it("populates the override from SecureStore during initI18n", async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue("zh" as never);
    await mod.initI18n();
    expect(mod.getSavedLocaleOverride()).toBe("zh");
    expect(mod.getCurrentLocale()).toBe("zh");
  });

  it("keeps the override null after initI18n when nothing is persisted", async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null as never);
    await mod.initI18n();
    expect(mod.getSavedLocaleOverride()).toBeNull();
  });
});