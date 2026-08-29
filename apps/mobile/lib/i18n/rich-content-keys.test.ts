import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Rich-content（迭代 115）i18n spot-checks：en/zh 双语言均有且 zh 是真实译名。
describe("rich content i18n", () => {
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
    "richContent.mermaid.title": "Mermaid 图",
    "richContent.mermaid.openFullscreen": "全屏查看",
    "richContent.mermaid.copySource": "复制源码",
    "richContent.mermaid.sourceCopied": "源码已复制",
    "richContent.mermaid.renderFailed": "Mermaid 图渲染失败",
    "richContent.mermaid.renderFailedHint": "请检查源码语法后重试",
    "richContent.mermaid.exportSvg": "导出 SVG",
    "richContent.mermaid.exportPng": "导出 PNG",
    "richContent.mermaid.exportMmd": "导出 MMD",
    "richContent.mermaid.close": "关闭",
    "richContent.html.title": "HTML 预览",
    "richContent.html.preview": "预览",
    "richContent.html.source": "源码",
    "richContent.html.viewFullscreen": "全屏查看",
  };

  it("carries every richContent.* key in both locales", () => {
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
});