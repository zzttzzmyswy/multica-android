import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(() => [{ languageCode: "en" }]),
}));

async function loadI18n() {
  return await import("./index");
}

/**
 * `initI18n` memoizes its first-launch work in a module-level promise. That
 * payload is a snapshot, so anything that awaits the promise later — a
 * formSheet picker route mounting after the user switched language — must be
 * handed the live locale instead. Getting this wrong showed up on device as an
 * English UI rendering Chinese dates (MYS-1191).
 */
describe("initI18n resolves the live locale", () => {
  beforeEach(async () => {
    const i18n = await loadI18n();
    i18n.resetI18nForTests();
  });

  it("returns the locale that is current when it settles, not the memoized one", async () => {
    const i18n = await loadI18n();
    await expect(i18n.initI18n()).resolves.toBe("en");

    i18n.setLocale("zh");
    await expect(i18n.initI18n()).resolves.toBe("zh");

    i18n.setLocale("en");
    await expect(i18n.initI18n()).resolves.toBe("en");
  });

  it("still resolves the persisted override on the first call", async () => {
    const i18n = await loadI18n();
    const SecureStore = await import("expo-secure-store");
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce("zh");
    await expect(i18n.initI18n()).resolves.toBe("zh");
    expect(i18n.getCurrentLocale()).toBe("zh");
  });
});
