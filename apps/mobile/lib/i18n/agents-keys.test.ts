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