import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Iteration-73 inbox detail i18n (detail-page archive/unarchive CTAs + the
// quick-create "Edit as advanced form" recovery affordance). Same contract as
// inbox-archive-keys.test.ts: every key resolves in BOTH locales and the zh
// value is actually translated.
describe("inbox detail i18n", () => {
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
    "inbox.detail.archive": "归档",
    "inbox.detail.unarchive": "取消归档",
    "inbox.detail.originalInput": "原始输入",
    "inbox.detail.editAdvanced": "在完整表单中编辑",
    "inbox.detail.notificationMissing": "这条通知已不可用。",
  };

  it("resolves every inbox detail key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const enValue = mod.translate(key);
      expect(enValue, key).not.toBe(key);
      expect(enValue.length, key).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key), key).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("en/zh key sets stay in parity (no key lives in only one locale)", () => {
    for (const key of Object.keys(ZH_SPOT)) {
      mod.setLocale("en");
      const en = mod.translate(key);
      mod.setLocale("zh");
      const zh = mod.translate(key);
      expect(en === key && zh === key, key).toBe(false); // both locales know it
      expect(en, key).not.toBe(key);
      expect(zh, key).not.toBe(key);
    }
  });
});