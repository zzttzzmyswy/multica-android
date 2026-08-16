import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Iteration-42 MCP i18n. Same contract as tokens-keys.test.ts: every key
// resolves in BOTH locales and the zh value is actually translated.
describe("mcp i18n", () => {
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
    "nav.mcpServers": "MCP 服务器",
    "mcp.title": "MCP 服务器",
    "mcp.addServer": "添加服务器",
    "mcp.emptyTitle": "还没有 MCP 服务器",
    "mcp.adminOnlyNote": "仅工作区 owner/admin 可以管理 MCP 服务器。",
    "mcp.deleteMessage": "删除「{{name}}」会同时将其从所有使用它的 agent 中移除。此操作不可撤销。",
    "mcp.form.createTitle": "新建 MCP 服务器",
    "mcp.form.editTitle": "编辑 MCP 服务器",
    "mcp.form.argsHint": "多个参数用空格分隔。",
    "mcp.agent.hint": "分配给该 agent 的工作区 MCP 服务器。每个分配拥有独立的启用开关。",
    "mcp.agent.removeConfirmMessage": "移除「{{name}}」后，该 agent 将不再使用此服务器。",
    "mcp.agent.libraryEmpty": "工作区库为空——请让 owner/admin 在「更多 → MCP 服务器」中添加。",
  };

  it("resolves every mcp key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const enValue = mod.translate(key);
      expect(enValue).not.toBe(key);
      expect(enValue.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("interpolates the delete confirm placeholder in both locales", () => {
    mod.setLocale("zh");
    expect(mod.translate("mcp.deleteMessage", { name: "docs" })).toBe(
      "删除「docs」会同时将其从所有使用它的 agent 中移除。此操作不可撤销。",
    );
    mod.setLocale("en");
    expect(mod.translate("mcp.agent.removeConfirmMessage", { name: "docs" })).toBe(
      'Remove "docs"? The agent will no longer use this server.',
    );
  });
});