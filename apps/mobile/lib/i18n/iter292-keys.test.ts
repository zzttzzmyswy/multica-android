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
 * Iteration 292 (MYS-2889): the workflow card's copy.
 *
 * Transcribed from upstream's
 * `packages/views/locales/{en,zh-Hans}/issues.json` under `workflows.detail`:
 *
 *   - `card_title` → `workflow.detail.card_title`, the sheet's subtitle;
 *   - `project.label` → `workflow.project.label`, reused as-is (iteration 289
 *     already carries it, and the card is the second surface to draw it — one
 *     word, one key).
 *
 * What the assertions are FOR, beyond "the key exists":
 *
 *   - `card_title` must interpolate BOTH names. Web's line is
 *     `"{{workflow}}" · 跟随项目"{{project}}"`; a version that dropped either
 *     placeholder would render a sentence about nothing, and pass a bare
 *     existence check. The quotes are STRAIGHT (`"`), not `「」` — upstream
 *     writes corner brackets, but this bundle's voice guide forbids them and
 *     `zh-glossary.test.ts` enforces that on every key, this one included.
 *   - the accessible strings must name the ACT, not only the destination. The
 *     card's rows are announcements with no visual anchor to lean on, so
 *     「进入这一列会交给 Ada」 says what entering does; 「交给 Ada」 alone would
 *     leave a screen-reader user unable to tell which row they are on.
 *   - the zh copy must not leak an English concept term (`issue` → 任务,
 *     `project` → 项目) per the repo glossary.
 */
describe("workflow card i18n (MYS-2889)", () => {
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
    "workflow.detail.card_title": '"{{workflow}}" · 跟随项目"{{project}}"',
    "workflow.detail.currentAria": "任务当前在这一列",
    "workflow.detail.handoffAria": "进入这一列会交给{{name}}",
    "workflow.detail.openAria": '查看"{{name}}"的完整流程',
    "workflow.detail.unverified": "未能加载这条工作流，无法显示它的全部列。",
    "workflow.project.label": "工作流",
  };

  const EN: Record<string, string> = {
    "workflow.detail.card_title": "{{workflow}} · from {{project}}",
    "workflow.detail.currentAria": "The issue is currently on this column",
    "workflow.detail.handoffAria": "Entering this column hands it off to {{name}}",
    "workflow.detail.openAria": "View the full {{name}} workflow",
    "workflow.detail.unverified": "Couldn't load this workflow, so its columns can't be shown.",
    "workflow.project.label": "Workflow",
  };

  it("resolves every card string in both bundles", () => {
    for (const [key, zhValue] of Object.entries(ZH)) {
      mod.setLocale("zh");
      expect(mod.translate(key), `zh ${key}`).toBe(zhValue);
      mod.setLocale("en");
      expect(mod.translate(key), `en ${key}`).toBe(EN[key]);
    }
  });

  it("interpolates BOTH names into the card title", () => {
    // Upstream's line names the workflow and the project it follows. Either
    // placeholder missing turns it into a sentence with its subject gone.
    mod.setLocale("zh");
    expect(
      mod.translate("workflow.detail.card_title", {
        workflow: "交付流程",
        project: "阿波罗",
      }),
    ).toBe('"交付流程" · 跟随项目"阿波罗"');
    mod.setLocale("en");
    expect(
      mod.translate("workflow.detail.card_title", {
        workflow: "Delivery",
        project: "Apollo",
      }),
    ).toBe("Delivery · from Apollo");
  });

  it("names the ACT in the accessible handoff line, not only the destination", () => {
    // A row's accessibility label is announced with no visual anchor: it has to
    // say what the row DOES, or the listener cannot tell which row they are on.
    mod.setLocale("zh");
    expect(mod.translate("workflow.detail.handoffAria", { name: "Ada" })).toBe(
      "进入这一列会交给Ada",
    );
    expect(mod.translate("workflow.detail.handoffAria", { name: "Ada" })).toContain("这一列");
    mod.setLocale("en");
    expect(mod.translate("workflow.detail.handoffAria", { name: "Ada" })).toBe(
      "Entering this column hands it off to Ada",
    );
  });

  it("announces the open trigger with the workflow's own name", () => {
    mod.setLocale("zh");
    expect(mod.translate("workflow.detail.openAria", { name: "交付流程" })).toContain("交付流程");
    mod.setLocale("en");
    expect(mod.translate("workflow.detail.openAria", { name: "Delivery" })).toBe(
      "View the full Delivery workflow",
    );
  });

  it("reuses the ONE key the project page already uses for the word 工作流", () => {
    // Two keys for one word is how the same concept grows two vocabularies
    // (the divergence `apps/mobile/CLAUDE.md` forbids).
    mod.setLocale("zh");
    expect(mod.translate("workflow.project.label")).toBe("工作流");
    mod.setLocale("en");
    expect(mod.translate("workflow.project.label")).toBe("Workflow");
  });

  it("keeps the zh copy free of English concept terms", () => {
    const forbidden = [/issue/i, /agent/i, /project/i, /workflow/i, /lead/i];
    for (const [key, value] of Object.entries(ZH)) {
      // Interpolation placeholders are identifiers, not prose — `{{project}}`
      // is the code that fills the translated word 项目 in, so the check looks
      // at the sentence with the placeholders removed.
      const prose = value.replace(/\{\{\w+\}\}/g, "");
      for (const pattern of forbidden) {
        expect(prose, `zh ${key} leaks ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
