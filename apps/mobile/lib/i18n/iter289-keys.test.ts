import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

/**
 * Iteration 289 (MYS-2690): the project-workflow binding's copy.
 *
 * Two things are pinned beyond "the key exists", because both are mistakes this
 * family of strings invites:
 *
 *   - the plural pairs must BOTH resolve and must differ in the way the count
 *     requires (a copy-paste that leaves `_one` with the plural body reads as a
 *     bug on a one-issue project);
 *   - the zh lines must not leak an English concept term. `workflow` is not on
 *     the glossary's concept list (it is a NAMED object, so 「Default」 /
 *     「Content」 stay as the workspace spelled them), but `issue`, `agent` and
 *     `project` are — a zh line that says "project" instead of 「项目」 would
 *     fail `zh-glossary.test.ts` too, and this suite is where the author finds
 *     out first.
 */
describe("project workflow i18n (MYS-2690)", () => {
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

  const ZH: Record<string, string> = {
    "workflow.project.label": "工作流",
    "workflow.project.switchFailed": "无法切换工作流",
    "workflow.project.pickerTitle": "选择工作流",
    "workflow.project.defaultBadge": "默认",
    "workflow.project.usedByNobody": "暂无项目使用",
    "workflow.project.noHandoffs": "无自动交接",
    "workflow.project.noWorkflows": "此工作区还没有工作流。",
    "workflow.project.unverified": "未能加载该项目的工作流。",
    "workflow.project.readOnly": "仅工作区管理员和项目负责人可以修改。",
    "workflow.project.checking": "正在检查切换会影响什么…",
    "workflow.mapping.nothingMoves": "所有任务的状态两个工作流都有，保持不变。",
    "workflow.mapping.confirmPlain": "切换",
    "workflow.mapping.cancel": "取消",
    "workflow.mapping.stalePlan": "预览之后项目已发生变化，请重新核对状态再试。",
    "workflow.mapping.destination": "移动到",
    "workflow.listSeparator": "、",
  };

  const EN: Record<string, string> = {
    "workflow.project.label": "Workflow",
    "workflow.project.pickerTitle": "Choose a workflow",
    "workflow.project.defaultBadge": "Default",
    "workflow.project.noHandoffs": "No handoffs",
    "workflow.mapping.nothingMoves":
      "Every issue's status is in both workflows, so nothing moves.",
    "workflow.mapping.confirmPlain": "Switch",
    "workflow.mapping.cancel": "Cancel",
    "workflow.listSeparator": ", ",
  };

  const PLURAL_PAIRS = [
    "workflow.project.statuses",
    "workflow.project.handoffs",
    "workflow.mapping.description",
    "workflow.mapping.needsMapping",
    "workflow.mapping.issueCount",
    "workflow.mapping.unchanged",
    "workflow.mapping.confirm",
  ];

  it("resolves every zh string, translated", () => {
    mod.setLocale("zh");
    for (const [id, expected] of Object.entries(ZH)) {
      expect(mod.translate(id), id).toBe(expected);
    }
  });

  it("resolves every en string", () => {
    // Both bundles carry these keys, so each is asserted under ITS OWN locale
    // — a missing zh key would otherwise pass by falling back to en.
    for (const [id, expected] of Object.entries(EN)) {
      expect(mod.translate(id), id).toBe(expected);
    }
  });

  it("interpolates the parameters the call sites pass", () => {
    expect(
      mod.translate("workflow.project.usedBy", { names: "Alpha, Beta" }),
    ).toBe("Used by: Alpha, Beta");
    mod.setLocale("zh");
    expect(mod.translate("workflow.mapping.confirm_one", { count: 1 })).toBe(
      "切换并更新 1 个任务",
    );
    expect(mod.translate("workflow.mapping.confirm_other", { count: 4 })).toBe(
      "切换并更新 4 个任务",
    );
  });

  it("has both halves of every plural pair, and they differ where the count does", () => {
    mod.setLocale("zh");
    for (const base of PLURAL_PAIRS) {
      const one = mod.translate(`${base}_one`, { count: 1 });
      const other = mod.translate(`${base}_other`, { count: 5 });
      expect(one, `${base}_one`).not.toBe(`${base}_one`);
      expect(other, `${base}_other`).not.toBe(`${base}_other`);
      // `description` counts issues with a zh measure word that does not
      // inflect, so its two halves are identical by design; every other pair
      // must read differently at 1 vs 5.
      if (base !== "workflow.mapping.description") {
        expect(one, base).not.toBe(other);
      }
    }
  });

  it("keeps the concept terms out of the zh lines", () => {
    // `issue` is 任务, `agent` 智能体, `project` 项目, `runtime` 运行时. A zh
    // string that leaves any of the English words is the leak the glossary
    // suite catches app-wide; here it fails next to the string that caused it.
    const englishConcept = /\b(issues?|agents?|projects?|runtimes?|daemons?|squads?)\b/i;
    for (const [id, value] of Object.entries(ZH)) {
      // Placeholders are bindings, not prose.
      const prose = value.replace(/\{\{[^}]*\}\}/g, "");
      expect(englishConcept.test(prose), `${id}: ${value}`).toBe(false);
    }
  });
});
