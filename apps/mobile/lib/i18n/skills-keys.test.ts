import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-31 skills management i18n. Same contract as
// labels-keys.test.ts: every key resolves in BOTH locales and the zh value is
// actually translated.
describe("skills management i18n", () => {
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
    "screen.skills": "技能",
    "nav.skills": "技能",
    "skills.loadError": "加载技能失败：",
    "skills.emptyTitle": "还没有技能",
    "skills.emptyDescription": "技能是可复用的指令包，agent 会在任务中按需加载。",
    "skills.createButton": "新建技能",
    "skills.new.title": "新建技能",
    "skills.form.name": "名称",
    "skills.form.nameRequired": "名称必填",
    "skills.form.description": "描述",
    "skills.form.create": "创建",
    "skills.form.save": "保存",
    "skills.createdFailed": "创建技能失败",
    "skills.saveFailed": "保存失败",
    "skills.delete": "删除技能",
    "skills.deleteTitle": "删除技能？",
    "skills.deleteFailed": "无法删除技能",
    "skills.notFound": "技能不存在或已被删除",
    "skills.origin.runtimeLocal": "本地运行时",
    "skills.origin.clawhub": "ClawHub",
    "skills.origin.skillsSh": "Skills.sh",
    "skills.origin.github": "GitHub",
    "skills.origin.manual": "手动",
    "skills.detail.createdBy": "创建者",
    "skills.detail.updatedAt": "更新时间",
    "skills.detail.origin": "来源",
    "skills.detail.readme": "SKILL.md",
    "skills.detail.files": "附加文件",
    "skills.detail.noFiles": "无附加文件",
    "skills.detail.labels": "标签",
    "skills.detail.noLabels": "无标签",
    "skills.detail.edit": "编辑",
    "skills.detail.delete": "删除",
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

  it("interpolates the origin label placeholders", () => {
    for (const [key, tag] of [
      ["skills.origin.runtimeLocal", "Runtime local"],
      ["skills.origin.manual", "Manual"],
    ] as const) {
      mod.setLocale("en");
      expect(mod.translate(key)).toBe(tag);
    }
  });
});