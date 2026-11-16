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
 * Iteration 293 (MYS-2889 follow-up): the handoff editor's copy.
 *
 * Transcribed from upstream's
 * `packages/views/locales/{en,zh-Hans}/issues.json` under `workflows.handoff`
 * and `workflows.editor`. What these assertions are FOR, beyond "the key
 * exists":
 *
 *   - every sentence that interpolates a name must actually carry the
 *     placeholder, or the UI would render a sentence about nobody;
 *   - the scope question's two answers must be DISTINGUISHABLE — one names the
 *     count, the other names one project — because choosing wrong writes to a
 *     workflow other projects depend on;
 *   - the zh copy must not leak an English concept term per the repo glossary
 *     (`issue` → 任务, `project` → 项目, `workflow` → 流程).
 */
describe("workflow handoff editor i18n (MYS-2889 follow-up)", () => {
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
    "workflow.handoff.title": '任务进入"{{status}}"时',
    "workflow.handoff.to": "交给",
    "workflow.handoff.mode_none": "不交接",
    "workflow.handoff.mode_none_hint": "负责人保持不变",
    "workflow.handoff.mode_agent": "交给智能体",
    "workflow.handoff.mode_agent_hint": "立即开始运行",
    "workflow.handoff.mode_member": "交给成员",
    "workflow.handoff.mode_member_hint": "只改负责人，不启动运行",
    "workflow.handoff.project_lead_label": "项目负责人",
    "workflow.handoff.project_lead_hint": "如果项目负责人是智能体，它会开始运行。",
    "workflow.handoff.pick_agent": "选择智能体",
    "workflow.handoff.pick_member": "选择成员",
    "workflow.handoff.instructions": "这一步做什么",
    "workflow.handoff.instructions_hint": "会和任务描述、评论一起交给负责人。",
    "workflow.handoff.instructions_placeholder": "这一步应该做什么？",
    "workflow.handoff.next": "完成时移到",
    "workflow.handoff.back": "被退回时移回",
    "workflow.handoff.noneOption": "不设置",
    "workflow.handoff.nextDefault": "下一列（{{status}}）",
    "workflow.handoff.nextHint":
      "负责人自己把任务移到下一列；只有需要返工时才退回。运行结束不会改变状态。",
    "workflow.handoff.previewBrief": "预览负责人收到的说明",
    "workflow.handoff.previewTitle": '"{{status}}"这一步的说明',
    "workflow.handoff.previewDescription":
      "任务进入这一步时，负责人会收到这些内容。预览不需要先保存。",
    "workflow.handoff.scopeLine": '属于"{{workflow}}"流程',
    "workflow.handoff.scopeLineShared": '属于"{{workflow}}"，也用于：{{projects}}',
    "workflow.handoff.scopeMore": "{{names}} 以及另外 {{count}} 个",
    "workflow.handoff.scopeQuestion": "这次改动应用到哪里？",
    "workflow.handoff.scopeAll": '使用"{{workflow}}"的全部 {{count}} 个项目',
    "workflow.handoff.scopeAllHint": "{{projects}} 都会用上新的交接设置",
    "workflow.handoff.scopeProject": '只有"{{project}}"',
    "workflow.handoff.scopeProjectHint":
      '把流程复制为"{{copy}}"给"{{project}}"用；其他项目保持原样',
    "workflow.handoff.save": "保存",
    "workflow.handoff.cancel": "取消",
    "workflow.handoff.saveFailed": "无法保存交接设置",
    "workflow.handoff.readOnly":
      "交接设置属于流程，只有流程所有者和工作区管理员可以修改。",
    "workflow.handoff.briefFailed": "无法生成这段说明，重试后再看。",
    "workflow.handoff.briefEmpty": "这位负责人不会收到额外说明。",
    "workflow.handoff.editAria": "这一列当前交给{{name}}，点击编辑",
    "workflow.handoff.noHandoffAria": '"{{status}}"这一列还没有设置交接，点击设置',
  };

  const EN: Record<string, string> = {
    "workflow.handoff.title": 'When an issue enters "{{status}}"',
    "workflow.handoff.to": "Hand to",
    "workflow.handoff.mode_none": "No handoff",
    "workflow.handoff.mode_none_hint": "The assignee stays the same",
    "workflow.handoff.mode_agent": "Hand to an agent",
    "workflow.handoff.mode_agent_hint": "Starts a run right away",
    "workflow.handoff.mode_member": "Hand to a member",
    "workflow.handoff.mode_member_hint": "Changes the assignee; nothing runs",
    "workflow.handoff.project_lead_label": "Project lead",
    "workflow.handoff.project_lead_hint": "If the project lead is an agent, it starts a run.",
    "workflow.handoff.pick_agent": "Choose an agent",
    "workflow.handoff.pick_member": "Choose a member",
    "workflow.handoff.instructions": "What this step does",
    "workflow.handoff.instructions_hint":
      "Sent to the handler with this run, alongside the issue description and comments.",
    "workflow.handoff.instructions_placeholder": "What should happen in this step?",
    "workflow.handoff.next": "When done, move to",
    "workflow.handoff.back": "If rejected, send back to",
    "workflow.handoff.noneOption": "Not set",
    "workflow.handoff.nextDefault": "Next column ({{status}})",
    "workflow.handoff.nextHint":
      "The handler moves the issue itself and sends it back only for rework, not blockers. A run ending never changes the status.",
    "workflow.handoff.previewBrief": "Preview the handler's brief",
    "workflow.handoff.previewTitle": 'Brief for the "{{status}}" step',
    "workflow.handoff.previewDescription":
      "What the handler receives when an issue enters this step. Saved changes are not required to preview.",
    "workflow.handoff.scopeLine": "Part of the {{workflow}} workflow",
    "workflow.handoff.scopeLineShared": "Part of {{workflow}}, also used by {{projects}}",
    "workflow.handoff.scopeMore": "{{names}} and {{count}} more",
    "workflow.handoff.scopeQuestion": "Where should this change apply?",
    "workflow.handoff.scopeAll": "All {{count}} projects using {{workflow}}",
    "workflow.handoff.scopeAllHint": "{{projects}} all use the new handoff",
    "workflow.handoff.scopeProject": "Only {{project}}",
    "workflow.handoff.scopeProjectHint":
      'Copies the workflow as "{{copy}}" for {{project}}; other projects stay as they are',
    "workflow.handoff.save": "Save",
    "workflow.handoff.cancel": "Cancel",
    "workflow.handoff.saveFailed": "Couldn't save the handoff",
    "workflow.handoff.readOnly":
      "Handoffs belong to the workflow; its owner and workspace admins change them.",
    "workflow.handoff.briefFailed": "Couldn't render this brief. Retry to see it.",
    "workflow.handoff.briefEmpty": "This handler receives no extra instructions.",
    "workflow.handoff.editAria": "This column hands off to {{name}}; tap to edit",
    "workflow.handoff.noHandoffAria": 'The "{{status}}" column hands off nothing; tap to set it',
  };

  it("defines the same key set in both bundles", () => {
    // A key present in one bundle and missing from the other renders its raw id
    // on screen for that language only — the defect this catches.
    expect(Object.keys(ZH).sort()).toEqual(Object.keys(EN).sort());
  });

  it("resolves every string in both bundles", () => {
    for (const [key, zhValue] of Object.entries(ZH)) {
      mod.setLocale("zh");
      expect(mod.translate(key), `zh ${key}`).toBe(zhValue);
      mod.setLocale("en");
      expect(mod.translate(key), `en ${key}`).toBe(EN[key]);
    }
  });

  it("interpolates the status into the sheet title", () => {
    mod.setLocale("zh");
    expect(mod.translate("workflow.handoff.title", { status: "审查中" })).toBe(
      '任务进入"审查中"时',
    );
    mod.setLocale("en");
    expect(mod.translate("workflow.handoff.title", { status: "In Review" })).toBe(
      'When an issue enters "In Review"',
    );
  });

  it("makes the two scope answers distinguishable by their own words", () => {
    // Choosing wrong writes to a workflow other projects depend on, so the two
    // rows must not read as variations of one sentence.
    mod.setLocale("zh");
    const all = mod.translate("workflow.handoff.scopeAll", {
      workflow: "交付流程",
      count: 3,
    });
    const one = mod.translate("workflow.handoff.scopeProject", { project: "阿波罗" });
    expect(all).toContain("交付流程");
    expect(all).toContain("3");
    expect(one).toContain("阿波罗");
    expect(one).not.toContain("交付流程");
    expect(one).not.toBe(all);
  });

  it("names the count beyond the shown projects in the 'more' phrasing", () => {
    // Upstream passes `others.length` — the count is the real total BEYOND the
    // names shown, so the reader can reconcile it with them.
    mod.setLocale("zh");
    expect(
      mod.translate("workflow.handoff.scopeMore", { names: "甲、乙、丙", count: 2 }),
    ).toBe("甲、乙、丙 以及另外 2 个");
  });

  it("says WHO may edit, not merely that the reader may not", () => {
    // A bare 「只读」 leaves the reader with no next step; naming the owner and
    // admins tells them who to ask.
    mod.setLocale("zh");
    const line = mod.translate("workflow.handoff.readOnly");
    expect(line).toContain("流程所有者");
    expect(line).toContain("管理员");
    mod.setLocale("en");
    const en = mod.translate("workflow.handoff.readOnly");
    expect(en).toContain("owner");
    expect(en).toContain("admin");
  });

  it("distinguishes a FAILED brief read from an empty brief", () => {
    // These must not be one string: "couldn't render" and "this handler is told
    // nothing" are different claims, and collapsing them restores the
    // read-failure-as-absence defect this repo has fixed repeatedly.
    mod.setLocale("zh");
    expect(mod.translate("workflow.handoff.briefFailed")).not.toBe(
      mod.translate("workflow.handoff.briefEmpty"),
    );
    expect(mod.translate("workflow.handoff.briefFailed")).toContain("无法");
    mod.setLocale("en");
    expect(mod.translate("workflow.handoff.briefFailed")).not.toBe(
      mod.translate("workflow.handoff.briefEmpty"),
    );
  });

  it("keeps the zh copy free of English concept terms", () => {
    const forbidden = [/issue/i, /agent/i, /project/i, /workflow/i, /lead/i, /handoff/i];
    for (const [key, value] of Object.entries(ZH)) {
      // Placeholders are identifiers, not prose.
      const prose = value.replace(/\{\{\w+\}\}/g, "");
      for (const pattern of forbidden) {
        expect(prose, `zh ${key} leaks ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("uses straight quotes, not corner brackets, in the zh copy", () => {
    // The bundle's voice guide forbids 「」; `zh-glossary.test.ts` enforces it
    // on every key, and this one is no exception.
    for (const [key, value] of Object.entries(ZH)) {
      expect(value, `zh ${key}`).not.toMatch(/[「」『』]/);
    }
  });
});
