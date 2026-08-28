import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// ChatQueue（迭代 114）i18n spot-checks：en/zh 双语言均有且 zh 是真实译名。
describe("chat queue i18n", () => {
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
    "chat.queue.title": "{{count}} 条排队消息",
    "chat.queue.clear": "全部清空",
    "chat.queue.steer": "引导",
    "chat.queue.steerUnavailable": "当前回复开始后才能引导",
    "chat.queue.edit": "编辑排队消息",
    "chat.queue.remove": "移除排队消息",
    "chat.queue.fallback": "排队消息",
    "chat.queue.actionFailed": "无法更新排队消息",
  };

  it("carries every chat.queue.* key in both locales", () => {
    mod.setLocale("en");
    for (const key of Object.keys(ZH_SPOT)) {
      expect(mod.translate(key)).not.toBeUndefined();
      expect(mod.translate(key)).not.toBe(key);
    }
    mod.setLocale("zh");
    for (const key of Object.keys(ZH_SPOT)) {
      expect(mod.translate(key)).not.toBeUndefined();
      expect(mod.translate(key)).not.toBe(key);
    }
  });

  it("zh values are real translations, not english leftovers", () => {
    mod.setLocale("zh");
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      expect(mod.translate(key)).toBe(zh);
    }
  });

  it("title interpolates the queued count", () => {
    mod.setLocale("en");
    expect(mod.translate("chat.queue.title", { count: 3 })).toBe("3 queued messages");
    mod.setLocale("zh");
    expect(mod.translate("chat.queue.title", { count: 2 })).toBe("2 条排队消息");
  });
});