import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Iteration-53 Settings timezone preference i18n. Same contract as
// settings-language-keys.test.ts: every key resolves in BOTH locales and the
// zh values are real translations.
async function loadI18n() {
  return await import("./index");
}

describe("settings timezone i18n", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  beforeEach(async () => {
    mod = await loadI18n();
    mod.resetI18nForTests();
    mod.setLocale("en");
  });

  const ZH_SPOT: Record<string, string> = {
    "settings.timezoneTitle": "查看时区",
    "settings.timezoneHint": "用于仪表盘、图表和向您展示的任何日期。个人偏好，在你的所有工作区中通用。",
    "settings.timezoneSearchPlaceholder": "搜索时区",
    "settings.timezoneEmpty": "没有匹配的时区",
    "settings.timezoneSyncFailed": "保存时区偏好失败。",
    "settings.timezoneCurrent": "当前",
    "settings.timezoneDevice": "设备",
  };

  it("resolves every timezone key in both locales", () => {
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