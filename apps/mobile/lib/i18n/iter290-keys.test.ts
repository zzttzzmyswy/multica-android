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
 * Iteration 290 (MYS-2743): the handoff confirmation's copy.
 *
 * The strings are transcribed from upstream's
 * `packages/views/locales/{en,zh-Hans}/issues.json` → `workflows.confirm.*`,
 * because the phone and the desktop are describing the same event and a user
 * who reads both should not have to work out that they match.
 *
 * Beyond "the key exists", three things are pinned because this family of
 * strings invites them:
 *
 *   - the plural pairs must BOTH resolve and differ where the count requires,
 *     except `minutes`/`hours` in zh, where the measure word does not inflect;
 *   - the zh lines must not leak an English concept term (`issue` → 任务,
 *     `agent` → 智能体, `project` → 项目);
 *   - `stop_hint` must warn about the CONSEQUENCE (two agents on one issue)
 *     rather than say "are you sure" — the consequence is the only reason the
 *     checkbox exists.
 */
describe("handoff confirmation i18n (MYS-2743)", () => {
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
    "workflow.confirm.title": '将 {{issue}} 移到"{{status}}"？',
    "workflow.confirm.reassign": "负责人将从 {{from}} 改为 {{to}}。",
    "workflow.confirm.reassign_run": "负责人将从 {{from}} 改为 {{to}}，它会立即开始运行。",
    "workflow.confirm.same_handler_run": "负责人仍是 {{to}}，它会开始处理这一步。",
    "workflow.confirm.unassigned": "未分配",
    "workflow.confirm.running_title": "{{name}} 还在运行（已运行 {{duration}}）",
    "workflow.confirm.stop_label": "停止 {{name}} 的运行",
    "workflow.confirm.queued_title": "{{name}} 的运行还在排队",
    "workflow.confirm.cancel_queued_label": "取消 {{name}} 排队中的运行",
    "workflow.confirm.brief_toggle": "{{name}} 会收到的说明",
    "workflow.confirm.confirm": "移到{{status}}",
    "workflow.confirm.cancel": "取消",
    "workflow.confirm.under_minute": "不到 1 分钟",
    "workflow.confirm.error": "无法移动任务",
    "workflow.confirm.retry": "重试",
    "workflow.confirm.project_title": '将 {{issue}} 移到"{{project}}"？',
    "workflow.confirm.project_confirm": "移到{{project}}",
    "workflow.confirm.sheetDismiss": "关闭",
  };

  const EN: Record<string, string> = {
    "workflow.confirm.title": "Move {{issue}} to “{{status}}”?",
    "workflow.confirm.reassign": "The assignee changes from {{from}} to {{to}}.",
    "workflow.confirm.unassigned": "Unassigned",
    "workflow.confirm.confirm": "Move to {{status}}",
    "workflow.confirm.cancel": "Cancel",
    "workflow.confirm.under_minute": "under a minute",
    "workflow.confirm.error": "Couldn’t move the issue",
    "workflow.confirm.retry": "Retry",
    "workflow.confirm.sheetDismiss": "Close",
  };

  it("resolves every zh string, translated", () => {
    mod.setLocale("zh");
    for (const [id, expected] of Object.entries(ZH)) {
      expect(mod.translate(id), id).toBe(expected);
    }
  });

  it("resolves every en string", () => {
    for (const [id, expected] of Object.entries(EN)) {
      expect(mod.translate(id), id).toBe(expected);
    }
  });

  it("interpolates the parameters the call sites pass", () => {
    expect(mod.translate("workflow.confirm.confirm", { status: "In progress" })).toBe(
      "Move to In progress",
    );
    expect(
      mod.translate("workflow.confirm.running_title", { name: "Ada", duration: "3 minutes" }),
    ).toBe("Ada is still running (for 3 minutes)");
    mod.setLocale("zh");
    expect(mod.translate("workflow.confirm.minutes_other", { count: 3 })).toBe("3 分钟");
    expect(mod.translate("workflow.confirm.hours_other", { count: 2 })).toBe("2 小时");
  });

  it("has both halves of every plural pair, differing where the language inflects", () => {
    // en inflects minute/minutes and hour/hours; zh does not (分钟 / 小时 are
    // invariant), so zh's halves are identical BY DESIGN and only its
    // resolvability is asserted. A zh pair that DID differ would be a copy
    // mistake, so that is asserted too.
    for (const base of ["workflow.confirm.minutes", "workflow.confirm.hours"]) {
      const enOne = mod.translate(`${base}_one`, { count: 1 });
      const enOther = mod.translate(`${base}_other`, { count: 5 });
      expect(enOne, base).not.toBe(`${base}_one`);
      expect(enOther, base).not.toBe(`${base}_other`);
      expect(enOne, base).not.toBe(enOther);

      mod.setLocale("zh");
      const zhOne = mod.translate(`${base}_one`, { count: 1 });
      const zhOther = mod.translate(`${base}_other`, { count: 5 });
      expect(zhOne, base).not.toBe(`${base}_one`);
      expect(zhOther, base).not.toBe(`${base}_other`);
      // Compares the TEMPLATES, not the interpolated strings: zh's measure
      // words do not inflect, so the two keys must hold the same wording — but
      // they still interpolate different counts (`1 分钟` vs `5 分钟`), which
      // would make a naive string comparison pass for the wrong reason.
      const zhTemplateOne = mod.translate(`${base}_one`, { count: "\u0000" });
      const zhTemplateOther = mod.translate(`${base}_other`, { count: "\u0000" });
      expect(zhTemplateOne, base).toBe(zhTemplateOther);
      mod.setLocale("en");
    }
  });

  it("says what happens if the previous run is NOT stopped", () => {
    // The checkbox's only justification. A hint that says "are you sure" would
    // leave the user guessing what the consequence is, which is the state this
    // dialog exists to end.
    mod.setLocale("en");
    expect(mod.translate("workflow.confirm.stop_hint")).toContain("two agents");
    mod.setLocale("zh");
    expect(mod.translate("workflow.confirm.stop_hint")).toContain("两个智能体");
  });

  it("keeps the concept terms out of the zh lines", () => {
    // `issue` is 任务, `agent` 智能体, `project` 项目, `runtime` 运行时. A zh
    // string that leaves any of the English words is the leak the glossary
    // suite catches app-wide; here it fails next to the string that caused it.
    const englishConcept = /\b(issues?|agents?|projects?|runtimes?|daemons?|squads?)\b/i;
    mod.setLocale("zh");
    const ids = [
      ...Object.keys(ZH),
      "workflow.confirm.stop_hint",
      "workflow.confirm.queued_hint",
      "workflow.confirm.errorBody",
      "workflow.confirm.minutes_one",
      "workflow.confirm.hours_one",
    ];
    for (const id of ids) {
      const value = mod.translate(id);
      // Placeholders are bindings, not prose.
      const prose = value.replace(/\{\{[^}]*\}\}/g, "");
      expect(englishConcept.test(prose), `${id}: ${value}`).toBe(false);
    }
  });
});
