import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-52 workspace-integration i18n (quick actions,
// repositories, integrations). Same contract as workspace-settings-keys.test.ts:
// every key resolves in BOTH locales and the zh value is actually translated.
describe("workspace integration i18n", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  async function loadI18n() {
    return await import("./index");
  }

  beforeEach(async () => {
    mod = await loadI18n();
    mod.resetI18nForTests();
    mod.setLocale("en");
  });

  const ZH_SPOT: Record<string, string> = {
    "screen.quickActions": "快捷操作",
    "screen.repositories": "代码仓库",
    "screen.integrations": "集成",
    "workspaceSettings.management": "工作区管理",
    "quickActions.title": "快捷操作",
    "quickActions.add": "新建快捷操作",
    "quickActions.visibilityPublic": "团队",
    "quickActions.visibilityPrivate": "仅自己",
    "quickActions.archived": "已归档",
    "quickActions.usedCount": "已使用 {{count}} 次",
    "quickActions.targetMissing": "执行者不可用",
    "quickActions.createTitle": "新建快捷操作",
    "quickActions.editTitle": "编辑快捷操作",
    "quickActions.fieldName": "名称",
    "quickActions.fieldVisibility": "谁可以使用",
    "quickActions.fieldTarget": "执行者",
    "quickActions.fieldPrompt": "提示词",
    "quickActions.templateNotSupported": "暂不支持变量，请删除 {{token}}。智能体本来就能读到这个任务。",
    "quickActions.deleteTitle": "删除这条快捷操作？",
    "repositories.title": "代码仓库",
    "repositories.add": "添加仓库",
    "repositories.sourceManual": "手动",
    "repositories.sourceGitHub": "GitHub",
    "repositories.deleteTitle": "移除这个仓库？",
    "repositories.githubPickerTitle": "选择 GitHub 仓库",
    "integrations.title": "集成",
    "integrations.notConnected": "未连接",
    "integrations.openInBrowser": "在浏览器中打开",
    "integrations.channel.lark": "飞书",
    "integrations.gh.masterTitle": "启用 GitHub 功能",
    "integrations.gh.masterOn":
      "关闭后，所有 GitHub 入口都会被隐藏，也不再产生新的副作用。后台已有数据不会被删除。",
    "integrations.gh.masterOff":
      "GitHub 功能已关闭。PR 侧栏、Co-authored-by trailer 与自动关联都已暂停。后台数据未删除。",
    "integrations.gh.sectionFeatures": "功能",
    "integrations.gh.prSidebarLabel": "Pull Request 侧栏",
    "integrations.gh.prSidebarDesc": "在任务详情侧栏中展示关联的 Pull Request。",
    "integrations.gh.coAuthorLabel": "Co-authored-by trailer",
    "integrations.gh.coAuthorPrefix": "在智能体提交的 commit 中追加",
    "integrations.gh.coAuthorSuffix": "。",
    "integrations.gh.autoLinkLabel": "任务 ↔ PR 自动关联",
    "integrations.gh.autoLinkDesc":
      "根据 PR 标题、正文和分支名匹配任务编号并自动建立链接。",
    "integrations.gh.saveFailed": "更新 GitHub 设置失败",
    "integrations.gh.readOnlyHint": "只读视图。只有管理员和所有者可以修改这些设置。",
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

  it("interpolates the used-count placeholder", () => {
    mod.setLocale("zh");
    expect(mod.translate("quickActions.usedCount", { count: 7 })).toBe(
      "已使用 7 次",
    );
    mod.setLocale("en");
    expect(mod.translate("quickActions.usedCount", { count: 7 })).toBe(
      "Used 7×",
    );
  });

  it("interpolates the connected-to placeholder", () => {
    mod.setLocale("en");
    expect(mod.translate("integrations.connectedTo", { names: "a, b" })).toBe(
      "Connected to a, b",
    );
  });
});