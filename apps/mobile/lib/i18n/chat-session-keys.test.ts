import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Iteration-61 chat session-management i18n (pin / unpin / rename / unarchive).
// Same contract as batch-keys.test.ts: every key resolves in BOTH locales and
// the zh value is actually translated.
describe("chat session management i18n", () => {
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
    "chat.rename": "重命名",
    "chat.renameTitle": "重命名会话",
    "chat.renamePlaceholder": "会话标题",
    "chat.pin": "置顶",
    "chat.unpin": "取消置顶",
    "chat.pinned": "已置顶",
    "chat.unarchive": "取消归档",
  };

  it("resolves every chat-session key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const enValue = mod.translate(key);
      expect(enValue).not.toBe(key);
      expect(enValue.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zh);
      mod.setLocale("en");
    }
  });
});
