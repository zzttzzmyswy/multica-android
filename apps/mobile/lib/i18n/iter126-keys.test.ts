import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n spot-checks for iteration 126 — the three create-skill paths (manual /
// URL import / runtime copy), the agent-owned MCP section, the editable
// workspace issue prefix, and the My Issues "all" scope. Same contract as
// iter119/…/iter125-keys.test.ts: every key resolves in BOTH locales and the
// zh value is a real translation, not the raw-id fallback.
describe("iteration 126 i18n", () => {
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
    // Create-method chooser (web create-skill-dialog.tsx MethodChooser).
    "skills.create.back": "返回",
    "skills.create.method.manualTitle": "手动创建",
    "skills.create.method.urlTitle": "从 URL 导入",
    "skills.create.method.runtimeTitle": "从运行时复制",
    // URL import form (web UrlForm).
    "skills.import.urlLabel": "Skill URL",
    "skills.import.supportedSources": "支持的来源",
    "skills.import.import": "导入",
    "skills.import.importing": "导入中…",
    "skills.import.failed": "导入失败",
    // Runtime-local bulk import (web RuntimeLocalSkillImportPanel).
    "skills.runtimeImport.runtimeLabel": "运行时",
    "skills.runtimeImport.discovering": "正在发现 skill…",
    "skills.runtimeImport.searchPlaceholder": "搜索 skill",
    "skills.runtimeImport.selectAll": "全选",
    "skills.runtimeImport.importing": "正在导入 {{done}}/{{total}}…",
    "skills.runtimeImport.noSelection": "请至少选择一个 skill。",
    "skills.runtimeImport.summaryCreated": "已创建",
    "skills.runtimeImport.summaryFailed": "失败",
    "skills.runtimeImport.problems": "需要处理",
    "skills.runtimeImport.done": "完成",
    // Agent-owned MCP config + runtime discovery (web mcp-config-tab).
    "mcp.agent.managedTitle": "智能体配置",
    "mcp.agent.managedAdd": "添加服务器",
    "mcp.agent.managedEmpty": "没有智能体专属服务器。添加后该智能体会拥有其他智能体没有的服务器。",
    "mcp.agent.managedDeleteTitle": "删除服务器？",
    "mcp.agent.managedSaved": "服务器已保存",
    "mcp.agent.redactedTitle": "配置已隐藏",
    "mcp.agent.workspaceTitle": "工作区服务器",
    "mcp.agent.runtimeTitle": "该运行时上的服务器",
    "mcp.agent.runtimeRefresh": "刷新",
    "mcp.agent.runtimeUnsupported": "该运行时不上报 MCP 服务器。",
    "mcp.agent.runtimeOverridden": "已被覆盖",
    // Workspace issue-prefix editing (web workspace-tab.tsx :429-457).
    "workspaceSettings.issuePrefixHint": "用于任务编号，例如 {{example}}。",
    "workspaceSettings.issuePrefixRequired": "前缀不能为空。",
    "workspaceSettings.issuePrefixConfirmTitle": "确认修改任务前缀？",
    "workspaceSettings.issuePrefixChange": "修改",
    // My Issues "all" scope (web my-issues-header.tsx :89-94). The empty text
    // names the union the scope actually selects, not "the whole workspace".
    "myIssues.scopeAll": "全部",
    "myIssues.emptyAll": "还没有指派给您、由您创建，或涉及您的智能体与小队的任务。",
  };

  it("resolves every iteration-126 key in both locales", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const enValue = mod.translate(key);
      expect(enValue, `en fallback leak: ${key}`).not.toBe(key);
      expect(enValue.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key), `zh mismatch: ${key}`).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("keeps the four import-summary buckets distinct", () => {
    // A collapsed wording would make "skipped" and "failed" read the same in
    // the summary the user acts on after a batch import.
    mod.setLocale("zh");
    const values = [
      mod.translate("skills.runtimeImport.summaryCreated"),
      mod.translate("skills.runtimeImport.summaryUpdated"),
      mod.translate("skills.runtimeImport.summarySkipped"),
      mod.translate("skills.runtimeImport.summaryFailed"),
    ];
    expect(new Set(values).size).toBe(4);
  });

  it("interpolates the runtime-import progress counter", () => {
    expect(
      mod.translate("skills.runtimeImport.importing", { done: 3, total: 7 }),
    ).toBe("Importing 3/7…");
    mod.setLocale("zh");
    expect(
      mod.translate("skills.runtimeImport.importing", { done: 3, total: 7 }),
    ).toBe("正在导入 3/7…");
  });

  it("interpolates the issue-prefix hint example and confirm message", () => {
    expect(
      mod.translate("workspaceSettings.issuePrefixHint", { example: "ACME-123" }),
    ).toBe("Used in issue numbers like ACME-123.");
    mod.setLocale("zh");
    expect(
      mod.translate("workspaceSettings.issuePrefixConfirmMessage", {
        oldPrefix: "OLD",
        newPrefix: "NEW",
      }),
    ).toContain("OLD-N");
  });
});
