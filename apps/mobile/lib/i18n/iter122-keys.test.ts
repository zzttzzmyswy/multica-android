import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n spot-checks for the iteration-122 swimlane view (MYS-1041). Same
// contract as iter119/iter120-keys.test.ts: every key resolves in BOTH
// locales (a zh value proves the en key is real, and vice versa) and the zh
// value is actually translated — not the raw id fallback.
describe("swimlane view i18n (MYS-1041)", () => {
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
    "issues.viewSwimlane": "泳道",
    "a11y.viewSwimlane": "泳道视图",
    "issues.swimlane.groupBy": "分组",
    "issues.swimlane.groupAssignee": "负责人",
    "issues.swimlane.groupProject": "项目",
    "issues.swimlane.groupParent": "父任务",
    "issues.swimlane.groupNoParent": "无父任务",
    "issues.swimlane.groupOtherParents": "其他父任务",
    "issues.swimlane.moveToLane": "移动到泳道",
    "issues.swimlane.pickOther": "选择其他…",
    "issues.swimlane.emptyCell": "无",
    "issues.swimlane.moreCards": "还有 {{count}} 条",
  };

  it("resolves every swimlane key in both locales", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const enValue = mod.translate(key);
      expect(enValue, `en fallback leak: ${key}`).not.toBe(key);
      expect(enValue.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("interpolates the cell-overflow count in both locales", () => {
    mod.setLocale("en");
    expect(mod.translate("issues.swimlane.moreCards", { count: 5 })).toBe(
      "+5 more",
    );
    mod.setLocale("zh");
    expect(mod.translate("issues.swimlane.moreCards", { count: 5 })).toBe(
      "还有 5 条",
    );
  });
});
