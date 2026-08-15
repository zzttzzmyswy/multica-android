import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

import * as SecureStore from "expo-secure-store";
import { getLocales } from "expo-localization";

// Imported lazily inside describe so the mocks above are registered first.
async function loadI18n() {
  return await import("./index");
}
async function loadReact() {
  return await import("./react");
}

describe("i18n translate", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await loadI18n();
    mod.resetI18nForTests();
    // default to English for deterministic results
    mod.setLocale("en");
  });

  it("translates a known key to English by default", () => {
    expect(mod.translate("login.title")).toBe("Sign in to Multica");
  });

  it("returns the raw id for an unknown key", () => {
    expect(mod.translate("does.not.exist")).toBe("does.not.exist");
  });

  it("switching to zh returns Chinese", () => {
    mod.setLocale("zh");
    expect(mod.translate("login.title")).toBe("登录 Multica");
  });

  it("interpolates parameters into placeholders", () => {
    expect(mod.translate("verify.subtitle", { email: "a@b.c" })).toBe(
      "We sent a 6-digit code to a@b.c",
    );
    mod.setLocale("zh");
    expect(mod.translate("verify.subtitle", { email: "a@b.c" })).toBe(
      "我们已将 6 位验证码发送至 a@b.c",
    );
  });

  it("notifies locale-change subscribers", () => {
    const fn = vi.fn();
    const unsub = mod.subscribeLocale(fn);
    mod.setLocale("zh");
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    mod.setLocale("en");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("initI18n device-language resolution", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await loadI18n();
    mod.resetI18nForTests();
  });

  it("uses the device zh language when no override is saved", async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null as never);
    vi.mocked(getLocales).mockReturnValue([
      { languageCode: "zh" } as never,
    ]);
    const locale = await mod.initI18n();
    expect(locale).toBe("zh");
  });

  it("uses a persisted zh override regardless of device language", async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue("zh" as never);
    vi.mocked(getLocales).mockReturnValue([
      { languageCode: "en" } as never,
    ]);
    const locale = await mod.initI18n();
    expect(locale).toBe("zh");
  });

  it("falls back to en for unsupported device languages", async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null as never);
    vi.mocked(getLocales).mockReturnValue([
      { languageCode: "fr" } as never,
    ]);
    const locale = await mod.initI18n();
    expect(locale).toBe("en");
  });
});