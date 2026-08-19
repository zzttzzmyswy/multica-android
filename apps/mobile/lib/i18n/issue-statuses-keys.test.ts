import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n for the issue-statuses management screen (MUL-6243). Same contract as
// labels-keys.test.ts: every key resolves in BOTH locales, and the zh value
// is actually translated.
describe("issue statuses management i18n", () => {
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
    "settings.issueStatusesTitle": "自定义状态",
    "settings.issueStatusesSubtitle": "管理工作区自定义 issue 状态",
    "settings.statuses.description": "状态决定 issue 生命周期在面板上的呈现。7 个内置状态不可修改；管理员可以添加自定义状态，每个自定义状态完整继承其所属类别的平台行为。",
    "settings.statuses.flagOff": "此服务器未开启自定义状态功能。",
    "settings.statuses.add": "新建状态",
    "settings.statuses.builtInLocked": "内置状态",
    "settings.statuses.archivedBadge": "已归档",
    "settings.statuses.actions.edit": "编辑",
    "settings.statuses.actions.archive": "归档",
    "settings.statuses.actions.moveUp": "上移",
    "settings.statuses.actions.moveDown": "下移",
    "settings.statuses.archiveTitle": "归档此状态？",
    "settings.statuses.archiveMessage": "已分配到此状态的问题会保留该状态并继续按所属类别行为；新的分配会被拒绝。",
    "settings.statuses.editor.titleCreate": "新建自定义状态",
    "settings.statuses.editor.titleEdit": "编辑状态",
    "settings.statuses.editor.name": "名称",
    "settings.statuses.editor.namePlaceholder": "例如：代码评审",
    "settings.statuses.editor.nameRequired": "名称必填",
    "settings.statuses.editor.key": "Key",
    "settings.statuses.editor.keyHint": "创建时由名称自动派生的稳定机器标识，之后不可修改。",
    "settings.statuses.editor.category": "类别",
    "settings.statuses.editor.categoryHint": "类别决定平台行为——此状态将表现得与类别内置状态完全一致。",
    "settings.statuses.editor.color": "颜色",
    "settings.statuses.editor.description": "描述",
    "settings.statuses.editor.save": "保存",
    "settings.statuses.editor.cancel": "取消",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en, key).not.toBe(key); // en present (not the raw id fallback)
      expect(en.length, key).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key), key).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("en/zh key sets stay in parity (no key lives in only one locale)", () => {
    const enKeys = Object.keys(ZH_SPOT);
    for (const key of enKeys) {
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