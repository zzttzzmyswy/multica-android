import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-28 labels management i18n. Same contract as
// agents-keys.test.ts: every key resolves in BOTH locales (a zh tag proves
// the en key is real, and vice versa) and the zh value is actually translated.
describe("labels management i18n", () => {
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
    "screen.labels": "标签",
    "nav.labels": "标签",
    "labels.loadError": "加载标签失败：",
    "labels.emptyTitle": "还没有标签",
    "labels.emptyDescription": "标签用于给问题做标记，如 bug、功能、性能等。",
    "labels.createButton": "新建标签",
    "labels.usageCount": "已使用 {{count}} 次",
    "labels.new.title": "新建标签",
    "labels.edit.title": "编辑标签",
    "labels.form.name": "名称",
    "labels.form.nameRequired": "名称必填",
    "labels.form.color": "颜色",
    "labels.form.description": "描述",
    "labels.form.create": "创建",
    "labels.form.save": "保存",
    "labels.createdFailed": "创建标签失败",
    "labels.saveFailed": "保存失败",
    "labels.delete": "删除标签",
    "labels.deleteTitle": "删除标签？",
    "labels.deleteMessage": "确认删除 \"{{name}}\"？它将从 {{count}} 个资源中移除。此操作无法撤销。",
    "labels.deleteFailed": "无法删除标签",
    "labels.notFound": "标签不存在或已被删除",
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

  it("interpolates the usage-count placeholder", () => {
    mod.setLocale("zh");
    expect(mod.translate("labels.usageCount", { count: 3 })).toContain("3");
    mod.setLocale("en");
    expect(mod.translate("labels.usageCount", { count: 3 })).toContain("3");
  });

  it("interpolates the delete-confirm placeholder", () => {
    mod.setLocale("zh");
    const zh = mod.translate("labels.deleteMessage", { name: "性能", count: 2 });
    expect(zh).toContain("性能");
    expect(zh).toContain("2");
    mod.setLocale("en");
    const en = mod.translate("labels.deleteMessage", { name: "perf", count: 2 });
    expect(en).toContain("perf");
    expect(en).toContain("2");
  });
});