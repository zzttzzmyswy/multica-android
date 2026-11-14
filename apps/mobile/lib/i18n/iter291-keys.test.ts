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
 * Iteration 291 (MYS-2874): the handoff hint's copy.
 *
 * Two families, transcribed from upstream's
 * `packages/views/locales/{en,zh-Hans}/issues.json`:
 *
 *   - `workflows.hands_off_to` → `workflow.handsOffTo`, the sentence the eye
 *     gets as a tooltip on web and the ear gets as a row label here;
 *   - `workflows.handler.*` → `workflow.handler.*`, the nouns that stand in
 *     while the directory is still resolving a name.
 *
 * Three properties are pinned beyond "the key exists", because this family of
 * strings invites exactly these mistakes:
 *
 *   - `handsOffTo` must interpolate the name. A version that dropped `{{name}}`
 *     would render 「交给」 on every row and pass a mere existence check.
 *   - the role nouns must be the SAME words `picker.agent` / `picker.squad` /
 *     `picker.people` already use, or the hint and the sheet it opens would
 *     describe the same actor with two vocabularies.
 *   - the zh lines must not leak an English concept term (`issue` → 任务,
 *     `agent` → 智能体, `project` → 项目).
 */
describe("handoff hint i18n (MYS-2874)", () => {
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
    "workflow.handsOffTo": "交给 {{name}}",
    "workflow.handler.agent": "智能体",
    "workflow.handler.squad": "小队",
    "workflow.handler.member": "成员",
    "workflow.handler.project_lead": "项目负责人",
    "workflow.handler.creator": "任务创建者",
    "workflow.handler.project_lead_named": "{{name}}（项目负责人）",
    "workflow.hint.rowAria": "选这一列会把任务交给{{name}}",
  };

  const EN: Record<string, string> = {
    "workflow.handsOffTo": "Hands off to {{name}}",
    "workflow.handler.agent": "Agent",
    "workflow.handler.squad": "Squad",
    "workflow.handler.member": "Member",
    "workflow.handler.project_lead": "Project lead",
    "workflow.handler.creator": "Issue creator",
    "workflow.handler.project_lead_named": "{{name}} (project lead)",
    "workflow.hint.rowAria": "Moving this issue here hands it off to {{name}}",
  };

  it("resolves every hint string in both bundles", () => {
    for (const [key, zhValue] of Object.entries(ZH)) {
      mod.setLocale("zh");
      expect(mod.translate(key), `zh ${key}`).toBe(zhValue);
      mod.setLocale("en");
      expect(mod.translate(key), `en ${key}`).toBe(EN[key]);
    }
  });

  it("interpolates the name, in both languages", () => {
    // The whole point of the sentence. A missing placeholder passes "the key
    // resolves" and fails here.
    mod.setLocale("zh");
    expect(mod.translate("workflow.handsOffTo", { name: "Ada" })).toBe("交给 Ada");
    expect(mod.translate("workflow.handsOffTo", { name: "智能体" })).toBe("交给 智能体");
    mod.setLocale("en");
    expect(mod.translate("workflow.handsOffTo", { name: "Ada" })).toBe("Hands off to Ada");
  });

  it("names a project lead WITH the role, so the reader knows why she is involved", () => {
    mod.setLocale("zh");
    expect(mod.translate("workflow.handler.project_lead_named", { name: "Grace" })).toBe(
      "Grace（项目负责人）",
    );
    mod.setLocale("en");
    expect(mod.translate("workflow.handler.project_lead_named", { name: "Grace" })).toBe(
      "Grace (project lead)",
    );
  });

  it("reuses the vocabulary the actor pickers already speak", () => {
    // A hint that says 「智能体」 over a sheet whose heading says something else
    // for the same actor is the divergence `apps/mobile/CLAUDE.md` forbids.
    mod.setLocale("en");
    expect(mod.translate("workflow.handler.agent")).toBe(mod.translate("picker.agent"));
    expect(mod.translate("workflow.handler.squad")).toBe(mod.translate("picker.squad"));
    mod.setLocale("zh");
    expect(mod.translate("workflow.handler.agent")).toBe(mod.translate("picker.agent"));
    expect(mod.translate("workflow.handler.squad")).toBe(mod.translate("picker.squad"));
  });

  it("keeps the zh copy free of English concept terms", () => {
    // The glossary rule (docs/developers/conventions.mdx §2): `issue` is 任务,
    // `agent` is 智能体, `project` is 项目. `Issue creator` must not reach zh as
    // 「Issue 创建者」.
    const forbidden = [/issue/i, /agent/i, /project/i, /squad/i, /lead/i];
    for (const [key, value] of Object.entries(ZH)) {
      for (const pattern of forbidden) {
        expect(value, `zh ${key} leaks ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("spells the row's accessible sentence as a whole sentence, not a fragment", () => {
    // `handsOffTo` is web's tooltip; a tooltip can lean on its anchor. The row's
    // `accessibilityLabel` cannot — it is announced with no visual context — so
    // `rowAria` names the act ("选这一列" / "Moving this issue here") rather
    // than only the destination.
    mod.setLocale("zh");
    expect(mod.translate("workflow.hint.rowAria", { name: "Ada" })).toContain("交给");
    expect(mod.translate("workflow.hint.rowAria", { name: "Ada" })).toContain("这一列");
    mod.setLocale("en");
    expect(mod.translate("workflow.hint.rowAria", { name: "Ada" })).toBe(
      "Moving this issue here hands it off to Ada",
    );
  });
});
