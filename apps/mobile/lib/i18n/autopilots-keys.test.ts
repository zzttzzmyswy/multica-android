import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-24 autopilot create/delete/trigger i18n.
// The contract: every key resolves in BOTH locales (a zh tag proves the en
// key is real, and vice versa) and the zh value is actually translated.
describe("autopilot create/trigger i18n", () => {
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
    "autopilots.new.title": "新建自动化",
    "autopilots.new.agentRequired": "请选择执行本自动化的智能体",
    "autopilots.new.create": "创建",
    "autopilots.detail.delete": "删除自动化",
    "autopilots.detail.addTrigger": "添加触发器",
    "autopilots.trigger.kind": "触发器类型",
    "autopilots.trigger.timezone": "时区",
    "autopilots.trigger.rotateUrl": "旋转 Webhook URL",
    "autopilots.trigger.urlCopied": "Webhook URL 已复制",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en).not.toBe(key); // en present (not the raw id fallback)
      expect(en.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("interpolates the delete-message title placeholder in zh", () => {
    mod.setLocale("zh");
    expect(mod.translate("autopilots.detail.deleteMessage", { title: "晨报" })).toContain(
      "晨报",
    );
  });
});