import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-97 agent custom-args i18n (MYS-683).
// Same contract as every keys test: every key resolves in BOTH locales (a zh
// tag proves the en key is real, and vice versa), the zh value is actually
// translated, and the key SETS stay symmetric.
describe("agents custom-args i18n", () => {
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

  const KEYS = [
    "agents.detail.menu.args",
    "agents.customArgs.title",
    "agents.customArgs.intro",
    "agents.customArgs.argumentsLabel",
    "agents.customArgs.argumentsDescription",
    "agents.customArgs.addArgumentAction",
    "agents.customArgs.addAction",
    "agents.customArgs.updateAction",
    "agents.customArgs.cancelAction",
    "agents.customArgs.commandPreviewLabel",
    "agents.customArgs.inputPlaceholder",
    "agents.customArgs.inputAria",
    "agents.customArgs.newArgumentAria",
    "agents.customArgs.emptyTitle",
    "agents.customArgs.emptyHint",
    "agents.customArgs.editAria",
    "agents.customArgs.removeAria",
    "agents.customArgs.saveFailedTitle",
  ];

  const ZH_SPOT: Record<string, string> = {
    "agents.detail.menu.args": "CLI 参数",
    "agents.customArgs.intro": "添加智能体启动时传入的 CLI 参数。",
    "agents.customArgs.argumentsLabel": "参数",
    "agents.customArgs.addArgumentAction": "添加参数",
    "agents.customArgs.commandPreviewLabel": "命令预览",
    "agents.customArgs.inputPlaceholder": "--profile",
    "agents.customArgs.emptyTitle": "还没有参数",
    "agents.customArgs.emptyHint": "添加第一个 token，开始构建启动命令。",
    "agents.customArgs.saveFailedTitle": "保存自定义参数失败",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const key of KEYS) {
      const en = mod.translate(key);
      expect(en).not.toBe(key); // en present (not the raw id fallback)
      expect(en.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      const zh = mod.translate(key);
      expect(zh.length).toBeGreaterThan(0);
      expect(zh).not.toBe(key);
      if (key in ZH_SPOT) {
        expect(zh).toBe(ZH_SPOT[key]);
      }
      mod.setLocale("en");
    }
  });

  it("en/zh key sets stay in parity (no key lives in only one locale)", () => {
    for (const key of KEYS) {
      mod.setLocale("en");
      expect(mod.translate(key)).not.toBe(key);
      mod.setLocale("zh");
      expect(mod.translate(key)).not.toBe(key);
    }
  });

  it("interpolates index into aria labels in both locales", () => {
    mod.setLocale("en");
    expect(mod.translate("agents.customArgs.editAria", { index: 2 })).toBe(
      "Edit argument 2",
    );
    expect(mod.translate("agents.customArgs.removeAria", { index: 3 })).toBe(
      "Remove argument 3",
    );
    expect(mod.translate("agents.customArgs.inputAria", { index: 1 })).toBe(
      "Argument 1",
    );

    mod.setLocale("zh");
    expect(mod.translate("agents.customArgs.editAria", { index: 2 })).toBe(
      "编辑参数 2",
    );
    expect(mod.translate("agents.customArgs.removeAria", { index: 3 })).toBe(
      "移除参数 3",
    );
    expect(mod.translate("agents.customArgs.inputAria", { index: 1 })).toBe(
      "参数 1",
    );
  });
});