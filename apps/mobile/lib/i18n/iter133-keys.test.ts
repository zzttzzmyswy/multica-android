import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n spot-checks for iteration 133 — the skills list's multi-select batch
// bar and the issue table's grouping. Same contract as
// iter119/…/iter132-keys.test.ts: every key resolves in BOTH locales and the
// zh value is a real translation, not the raw-id fallback.
// (`lib/i18n/locale-completeness.test.ts` covers the "defined at all" half
// mechanically; this pins the wording that carries meaning the id cannot.)
describe("iteration 133 i18n", () => {
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
    // Skills multi-select batch bar (web SkillBatchToolbar / its two dialogs).
    "skills.batch.enterSelection": "多选 skill",
    "skills.batch.exitSelection": "退出多选",
    "skills.batch.selectOne": "选择 {{name}}",
    "skills.batch.partial": "已添加 {{owned}}/{{total}}",
    "skills.batch.deleteTitle": "删除 {{count}} 个 skill？",
    "skills.batch.deleteMessage": "将永久删除选中的 skill，且无法撤销。",
    "skills.batch.deleteNoPermission": "只能删除自己创建的 skill。",
    "skills.batch.deleteSuccess": "已删除 {{count}} 个 skill",
    "skills.batch.deleteFailed": "无法删除选中的 skill，请重试。",
    "skills.batch.deletePartial": "已删除 {{done}} 个，{{failed}} 个失败：{{message}}",
    "skills.batch.addedOne": "已把 skill 加入 1 个智能体",
    "skills.batch.addedCount": "已把 skill 加入 {{count}} 个智能体",
    "skills.batch.addPartial": "已加入 {{done}} 个智能体，{{failed}} 个失败：{{message}}",
    // Issue table grouping (web tableGroupSpec dimensions).
    "table.groupBy": "分组方式",
    "table.groupNone": "不分组",
    "table.noValue": "无值",
    "table.valueUnavailable": "值不可用",
    "a11y.tableGroup": "分组",
    "a11y.tableCollapseGroup": "收起分组",
    "a11y.tableExpandGroup": "展开分组",
  };

  it("resolves every new key in both locales, with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en, key).not.toBe(key);
      expect(en.length, key).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key), key).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("interpolates the counts the batch bar reports", () => {
    expect(mod.translate("skills.batch.deleteTitle", { count: 3 })).toContain(
      "3",
    );
    expect(mod.translate("skills.batch.deleteSuccess", { count: 3 })).toContain(
      "3",
    );
    const partial = mod.translate("skills.batch.deletePartial", {
      done: 2,
      failed: 1,
      message: "404",
    });
    expect(partial).toContain("404");
    expect(partial).not.toContain("{{");
    expect(
      mod.translate("skills.batch.partial", { owned: 1, total: 3 }),
    ).toContain("1");
  });
});
