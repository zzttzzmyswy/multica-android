import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n spot-checks for the iteration-119 agent Skills section + projects
// search/filter/sort/batch copy. Same contract as mcp-keys.test.ts: every key
// resolves in BOTH locales (a zh tag proves the en key is real, and vice
// versa) and the zh value is actually translated.
describe("agent skills + projects list i18n (MYS-1020)", () => {
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
    "agents.skills.assignedTitle": "Skills",
    "agents.skills.assignedHint": "分配给该智能体的工作区 skill。可临时关闭而不必移除。",
    "agents.skills.addAction": "添加",
    "agents.skills.emptyTitle": "尚未分配 skill。",
    "agents.skills.emptyWorkspace": "工作区还没有 skill——请先在\"更多 → Skills\"中创建。",
    "agents.skills.noDescription": "暂无描述",
    "agents.skills.toggleAria": "切换 {{name}}",
    "agents.skills.toggleFailed": "切换失败",
    "agents.skills.removeAria": "移除 {{name}}",
    "agents.skills.removeConfirmTitle": "移除 skill？",
    "agents.skills.removeConfirmMessage": "移除\"{{name}}\"？该智能体将不再使用此 skill。",
    "agents.skills.removeAction": "移除",
    "agents.skills.removeFailed": "移除 skill 失败",
    "agents.skills.addDialogTitle": "添加 skill",
    "agents.skills.addDialogEmpty": "工作区 skill 库为空——请先在\"更多 → Skills\"中创建。",
    "agents.skills.addDialogEmptyPartial": "工作区的所有 skill 都已分配给该智能体。",
    "agents.skills.addFailed": "添加 skill 失败",
    "agents.skills.runtimeTitle": "运行时 skill",
    "agents.skills.runtimeHint": "从\"{{runtime}}\"本地 skill 目录继承的 skill。",
    "agents.skills.runtimeMissing": "该智能体未绑定运行时，没有可继承的本地 skill。",
    "agents.skills.runtimeOffline": "绑定的运行时离线——连接后才能发现其本地 skill。",
    "agents.skills.runtimeDiscovering": "正在发现本地 skill…",
    "agents.skills.runtimeForbidden": "你没有查看该运行时 skill 清单的权限。",
    "agents.skills.runtimeFailed": "发现本地 skill 失败。点\"刷新\"重试。",
    "agents.skills.runtimeUnsupported": "该运行时不支持本地 skill 发现。",
    "agents.skills.runtimeEmpty": "该运行时上没有发现本地 skill。",
    "agents.skills.refreshAction": "刷新",
    "agents.skills.runtimeToggleAria": "切换 {{name}}",
    "agents.skills.runtimeToggleFailed": "切换失败",
    "projects.searchPlaceholder": "搜索项目",
    "projects.filter": "筛选",
    "projects.filterStatus": "状态",
    "projects.filterPriority": "优先级",
    "projects.sort": "排序",
    "projects.sortName": "名称",
    "projects.sortPriority": "优先级",
    "projects.sortStatus": "状态",
    "projects.sortProgress": "进度",
    "projects.sortCreated": "创建时间",
    "projects.sortAscending": "升序",
    "projects.sortDescending": "降序",
    "projects.clearFilters": "清除筛选",
    "projects.resultsCount": "{{count}} 个项目",
    "projects.noMatches": "没有符合搜索或筛选条件的项目。",
    "projects.select": "选择",
    "projects.selectAll": "全选",
    "projects.clearSelection": "取消选择",
    "projects.selectedCount": "已选 {{count}} 个",
    "projects.batchPin": "置顶",
    "projects.batchUnpin": "取消置顶",
    "projects.batchDelete": "删除",
    "projects.batchDeleteTitle": "删除项目？",
    "projects.batchDeleteMessage": "删除 {{count}} 个项目？此操作不可撤销。",
    "projects.batchDeleteFailed": "删除项目失败",
    "projects.batchPinFailed": "更新置顶失败",
    "projects.pin": "置顶",
    "projects.unpin": "取消置顶",
  };

  it("resolves every new key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const enValue = mod.translate(key);
      expect(enValue, `en fallback leak: ${key}`).not.toBe(key);
      expect(enValue.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("interpolates the skill remove confirm placeholder", () => {
    mod.setLocale("en");
    expect(
      mod.translate("agents.skills.removeConfirmMessage", { name: "docs" }),
    ).toBe('Remove "docs"? The agent will no longer use this skill.');
    mod.setLocale("zh");
    expect(
      mod.translate("agents.skills.removeConfirmMessage", { name: "docs" }),
    ).toBe("移除\"docs\"？该智能体将不再使用此 skill。");
  });

  it("interpolates the batch delete count in both locales", () => {
    mod.setLocale("en");
    expect(mod.translate("projects.batchDeleteMessage", { count: 3 })).toBe(
      "Delete 3 projects? This cannot be undone.",
    );
    mod.setLocale("zh");
    expect(mod.translate("projects.batchDeleteMessage", { count: 3 })).toBe(
      "删除 3 个项目？此操作不可撤销。",
    );
  });
});
