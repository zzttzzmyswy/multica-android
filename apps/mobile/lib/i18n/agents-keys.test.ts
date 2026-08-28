import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-25 agents list/detail i18n. Same contract as
// autopilots-keys.test.ts: every key resolves in BOTH locales (a zh tag proves
// the en key is real, and vice versa) and the zh value is actually translated.
describe("agents list/detail i18n", () => {
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
    "agents.loadError": "加载 agents 失败：",
    "agents.emptyTitle": "还没有智能体",
    "agents.emptyDescription": "在 Web 端创建的工作区智能体会显示在这里，可查看状态并在手机上接手任务。",
    "agents.goChat": "去聊天页发起会话",
    "agents.status.active": "活跃",
    "agents.status.archived": "已归档",
    "agents.availability.online": "在线",
    "agents.availability.unstable": "不稳定",
    "agents.availability.offline": "离线",
    "agents.availability.archived": "已归档",
    "agents.taskCount": "{{count}} 个活跃任务",
    "agents.needsRuntime": "需绑定运行时",
    "agents.runtime.local": "本地",
    "agents.runtime.cloud": "云端",
    "agents.runtime.unbound": "未绑定",
    "agents.visibility.workspace": "工作区",
    "agents.visibility.private": "私有",
    "agents.detail.properties": "基本信息",
    "agents.detail.fieldModel": "模型",
    "agents.detail.fieldVisibility": "可见性",
    "agents.detail.fieldRuntimeMode": "运行时模式",
    "agents.detail.fieldRuntime": "运行时",
    "agents.detail.fieldOwner": "负责人",
    "agents.detail.fieldCreated": "创建时间",
    "agents.detail.tasks": "运行任务",
    "agents.detail.noTasks": "暂无活动任务。",
    "agents.activity.sectionNow": "进行中",
    "agents.activity.sectionLast30d": "最近 30 天",
    "agents.activity.sectionRecent": "最近完成",
    "agents.activity.subtitleActive": "{{count}} 个进行中任务",
    "agents.activity.subtitleNoActive": "暂无进行中的任务",
    "agents.activity.subtitlePerformance": "性能",
    "agents.activity.subtitleNoRecent": "暂无完成记录",
    "agents.activity.subtitleRecentProgress": "已显示 {{shown}} / {{total}} 条",
    "agents.activity.subtitleRecentLatest": "最新 {{count}} 条",
    "agents.activity.emptyNow": "该 agent 当前没有进行中的任务。",
    "agents.activity.empty30d": "最近 30 天没有完成任务。",
    "agents.activity.emptyRecent": "该 agent 还没有完成过任何任务。",
    "agents.activity.showMore": "显示更多",
    "agents.activity.runs": "次运行",
    "agents.activity.successPct": "成功率 {{percent}}%",
    "agents.activity.avgDuration": "平均 {{value}}",
    "agents.activity.failedCount": "失败 {{count}} 次",
    "agents.activity.cancelTask": "取消",
    "agents.activity.cancelFailedToast": "取消失败，请重试",
    "agents.activity.viewTranscript": "查看执行记录",
    "agents.activity.transcriptTitle": "任务执行记录",
    "agents.createButton": "新建",
    "agents.rowActions.duplicate": "复制",
    "agents.duplicate.copySuffix": "（副本）",
    "agents.duplicate.title": "复制 {{name}}",
    "agents.duplicate.envNotice": "指令、skill 和命令行参数会被复制。环境变量、MCP 服务器和本机运行时配置不会复制。",
    "agents.duplicate.runtimeResetNotice": "原运行时当前不可用，副本已改用其他运行时。模型、思考等级和速度只在所选运行时上有效，因此已被清空。",
    "agents.new.title": "创建智能体",
    "agents.new.chooseTitle": "你想从哪里开始？",
    "agents.new.manual.title": "从空白开始",
    "agents.new.manual.description": "自己配置每个字段。适合已经明确知道智能体应该如何工作的用户。",
    "agents.new.ai.title": "通过 AI 创建",
    "agents.new.ai.description": "描述你想要的结果。Agent Builder 会提出关键问题并实时生成草稿。",
    "agents.new.comingSoon": "即将开放",
    "agents.new.identity": "身份",
    "agents.new.identityHint": "为智能体设置容易识别的名称和简洁的用途。",
    "agents.new.behavior": "行为与能力",
    "agents.new.behaviorHint": "定义它的工作方式，并添加可使用的工作区 skill。",
    "agents.new.execution": "执行配置",
    "agents.new.executionHint": "选择智能体使用的运行时，也可以覆盖运行时的默认模型、思考等级和速度。",
    "agents.new.nameRequired": "请填写名称。",
    "agents.new.descriptionLabel": "描述",
    "agents.new.instructionsLabel": "指令",
    "agents.new.skillsLabel": "Skills",
    "agents.new.skillsEmpty": "工作区还没有 skill，请先创建或导入。",
    "agents.new.runtimeLabel": "运行时",
    "agents.new.runtimeRequired": "请选择运行时后再创建。",
    "agents.new.runtimesNone": "没有可用的运行时，请先接入一个。",
    "agents.new.modelLabel": "模型",
    "agents.new.thinkingLabel": "思考等级",
    "agents.new.speedLabel": "速度",
    "agents.new.access": "访问权限",
    "agents.new.accessPrivate": "仅自己",
    "agents.new.accessPrivateDesc": "只有你可以运行此智能体。",
    "agents.new.accessWorkspace": "整个工作区",
    "agents.new.accessMembers": "指定成员",
    "agents.new.accessMembersRequired": "请至少选择一位成员。",
    "agents.new.membersLabel": "成员",
    "agents.new.membersPlaceholder": "选择成员",
    "agents.new.create": "创建智能体",
    "agents.new.creating": "创建中…",
    "agents.new.failedMessage": "无法创建智能体。",
    "agents.new.nameConflict": "工作区中已存在同名智能体。",
    "agents.edit.title": "编辑智能体",
    "agents.edit.save": "保存",
    "agents.edit.saving": "保存中…",
    "agents.edit.failedMessage": "无法更新智能体。",
    "agents.edit.accessOwnerOnly": "只有负责人可以修改谁可以运行此智能体。",
    "agents.access.section_title": "谁可以运行此智能体",
    "agents.access.trigger_private": "仅我自己",
    "agents.access.trigger_workspace": "整个工作区",
    "agents.access.trigger_members_count": "{{count}} 人",
    "agents.access.trigger_members_empty": "指定成员",
    "agents.access.private_title": "仅我自己",
    "agents.access.private_desc": "只有你可以运行此智能体",
    "agents.access.workspace_title": "整个工作区",
    "agents.access.workspace_desc": "工作区所有成员都可以运行此智能体",
    "agents.access.members_title": "指定成员",
    "agents.access.members_desc": "只有你选中的成员可以运行此智能体",
    "agents.access.shared_target_required": "保存前请至少选择一位成员。",
    "agents.access.members_empty": "工作区没有可选择的成员",
    "agents.access.owner_only_readonly": "只有负责人可以修改谁可以运行此智能体。",
    "agents.access.memberSelectTitle": "选择可以运行它的成员",
    "agents.access.membersSummary": "{{count}} 位成员",
    "agents.access.saved": "访问权限已保存",
    "agents.access.saveFailed": "保存访问权限失败",
    "agents.scope.workspace": "整个工作区",
    "agents.scope.specificPeople": "指定成员",
    "agents.scope.ownerOnly": "仅负责人",
    "agents.batch.enterSelection": "选择",
    "agents.batch.selectAll": "全选",
    "agents.batch.selectedCount": "已选 {{count}} 项",
    "agents.batch.actions.archive": "归档",
    "agents.batch.actions.restore": "恢复",
    "agents.batch.actions.setAccess": "设置访问权限",
    "agents.batch.apply": "应用",
    "agents.batch.confirmArchiveTitle": "归档所选智能体？",
    "agents.batch.confirmArchiveMessage": "将归档 {{count}} 个智能体。归档后无法再被指派或提及，但所有历史都会保留，之后可恢复。",
    "agents.batch.resultPartial": "已更新 {{succeeded}} 项，跳过 {{skipped}} 项（非你所有）",
    "agents.batch.noOwnedSelected": "所选智能体均非你所有。",
    "agents.env.title": "环境变量",
    "agents.env.revealAction": "解锁并编辑",
    "agents.env.keyPlaceholder": "KEY",
    "agents.env.duplicateKeys": "环境变量 key 重复",
    "agents.detail.menu.edit": "编辑",
    "agents.detail.menu.env": "环境变量",
    "agents.detail.menu.archive": "归档",
    "agents.detail.menu.restore": "恢复",
    "agents.detail.archivedBanner": "该智能体已归档，无法被分配或提及。",
    "agents.detail.cancelMenu": "取消全部 task",
    "agents.detail.cancelTitle": "取消\"{{name}}\"的全部 task？",
    "agents.detail.cancelRunningCount": "{{count}} 个进行中",
    "agents.detail.cancelQueuedCount": "{{count}} 个排队中",
    "agents.detail.cancelImpactOne": "将取消 {{summary}}。",
    "agents.detail.cancelImpactOther": "将取消 {{summary}}。",
    "agents.detail.cancelRunningNote": "进行中的 task 最多需要 5 秒才能完全停止。",
    "agents.detail.cancelIrreversible": "已取消的 task 无法恢复。",
    "agents.detail.cancelKeep": "保留",
    "agents.detail.cancelConfirm": "取消全部 task",
    "agents.detail.cancelSuccessOne": "已取消 {{count}} 个 task",
    "agents.detail.cancelSuccessOther": "已取消 {{count}} 个 task",
    "agents.detail.cancelNoTasks": "没有要取消的活动 task",
    "agents.detail.cancelFailedTitle": "取消 task 失败",
    "agents.detail.cancelFailedMessage": "请重试。",
    "agents.detail.archiveTitle": "归档智能体？",
    "a11y.agentActions": "智能体操作",
    "a11y.openIssue": "打开关联问题",
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

  it("interpolates the task-count placeholder", () => {
    mod.setLocale("zh");
    expect(mod.translate("agents.taskCount", { count: 3 })).toContain("3");
  });
});