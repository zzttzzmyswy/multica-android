import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-27 squads list/detail i18n. Same contract as
// agents-keys.test.ts: every key resolves in BOTH locales (a zh tag proves
// the en key is real, and vice versa) and the zh value is actually translated.
describe("squads list/detail i18n", () => {
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
    "screen.squads": "小队",
    "nav.squads": "小队",
    "squads.loadError": "加载小队失败：",
    "squads.emptyTitle": "还没有小队",
    "squads.emptyDescription": "小队是平台上的多 agent 协作单元，由队长带队完成问题。",
    "squads.createButton": "新建小队",
    "squads.archived": "已归档",
    "squads.memberCount": "{{count}} 名成员",
    "squads.status.working": "工作中",
    "squads.status.idle": "空闲",
    "squads.status.offline": "离线",
    "squads.status.unstable": "不稳定",
    "squads.picker.addMember": "添加成员",
    "squads.new.title": "新建小队",
    "squads.new.name": "名称",
    "squads.new.nameRequired": "名称必填",
    "squads.new.leader": "队长",
    "squads.new.selectLeader": "选择队长智能体",
    "squads.new.create": "创建",
    "squads.detail.members": "成员",
    "squads.detail.addMember": "添加成员",
    "squads.detail.setLeader": "设为队长",
    "squads.detail.removeMember": "移除成员",
    "squads.detail.archive": "归档小队",
    "squads.detail.leaderChip": "队长",
    "squads.detail.activeTask": "正在运行任务…",
    "squads.instructions.title": "指令",
    "squads.instructions.description": "小队指引会在 Leader 智能体处理分配给该小队的任务时注入到它的 prompt 中。可用来给 Leader 提供贯穿全队的指导、协作规范，或每次 task 都应遵循的上下文。",
    "squads.instructions.edit": "编辑指令",
    "squads.instructions.empty": "还没有指令",
    "squads.instructions.placeholder": "例如：始终先写一个会失败的测试；偏好小步、原子的提交。",
    "squads.instructions.saved": "指令已保存",
    "squads.instructions.unsaved": "有未保存的修改",
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

  it("interpolates the member-count placeholder", () => {
    mod.setLocale("zh");
    expect(mod.translate("squads.memberCount", { count: 3 })).toContain("3");
    mod.setLocale("en");
    expect(mod.translate("squads.memberCount", { count: 3 })).toContain("3");
  });
});