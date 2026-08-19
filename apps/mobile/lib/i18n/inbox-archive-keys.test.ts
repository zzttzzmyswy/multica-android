import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Iteration-72 inbox archive-view i18n (archived sub-view + row long-press
// menu). Same contract as chat-session-keys.test.ts: every key resolves in
// BOTH locales and the zh value is actually translated.
describe("inbox archive-view i18n", () => {
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
    "inbox.archivedTitle": "已归档",
    "inbox.archivedEmpty": "从主收件箱归档的条目会显示在这里。",
    "inbox.archivedLoadError": "无法加载已归档通知：",
    "inbox.menu.markRead": "标为已读",
    "inbox.menu.markUnread": "标为未读",
    "inbox.menu.unarchive": "取消归档",
  };

  it("resolves every inbox archive key in both locales with a real zh translation", () => {
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