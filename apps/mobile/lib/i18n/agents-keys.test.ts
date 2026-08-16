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
    "agents.createButton": "新建",
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
    "agents.env.title": "环境变量",
    "agents.env.revealAction": "解锁并编辑",
    "agents.env.keyPlaceholder": "KEY",
    "agents.env.duplicateKeys": "环境变量 key 重复",
    "agents.detail.menu.edit": "编辑",
    "agents.detail.menu.env": "环境变量",
    "agents.detail.menu.archive": "归档",
    "agents.detail.menu.restore": "恢复",
    "agents.detail.archivedBanner": "该智能体已归档，无法被分配或提及。",
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