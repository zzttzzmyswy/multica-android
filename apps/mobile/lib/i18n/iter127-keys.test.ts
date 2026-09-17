import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n spot-checks for iteration 127 — the GitHub connect/disconnect card,
// the board column quick-create, the comment editor and the squads scope
// switcher. Same contract as iter119/…/iter126-keys.test.ts: every key
// resolves in BOTH locales and the zh value is a real translation, not the
// raw-id fallback. (`lib/i18n/locale-completeness.test.ts` covers the
// "defined at all" half mechanically; this pins the wording that carries
// meaning the id cannot.)
describe("iteration 127 i18n", () => {
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
    // GitHub connection card (web settings.json github.*, copied so the two
    // clients say the same thing about the same installation).
    "integrations.gh.connectionSection": "连接",
    "integrations.gh.connectGithub": "连接 GitHub",
    "integrations.gh.connectOpening": "正在打开…",
    "integrations.gh.connectedBy": "由 {{name}} 连接",
    "integrations.gh.contactAdmin":
      "当前工作区尚未连接 GitHub。请让管理员或所有者完成 GitHub App 的配置。",
    "integrations.gh.disconnect": "断开",
    "integrations.gh.disconnecting": "断开中…",
    "integrations.gh.disconnectTitle": "断开 GitHub App",
    "integrations.gh.disconnectConfirm": "断开",
    "integrations.gh.notConfiguredToast": "当前部署未配置 GitHub 集成",
    "integrations.gh.readOnlyConnection":
      "只读视图。只有管理员和所有者可以连接或断开 GitHub。",
    // Board column quick create.
    "issues.boardAddIssue": "在该列新建任务",
    // Comment editor.
    "menu.edit": "编辑",
    "comment.editComment": "编辑评论",
    "comment.saving": "保存中…",
    "comment.updateFailed": "更新评论失败",
    // Squads scope switcher (web squads.json scope.*).
    "squads.scope.mine": "我的",
    "squads.scope.all": "全部",
    "squads.scopeEmptyMine": "您还没有创建过小队。",
    "squads.scopeEmptyMineHint":
      "切换到\"全部\"可以浏览该工作区中的所有小队。",
    // Issues-list working-only quick filter.
    "filter.quick": "快捷筛选",
    "filter.workingOnly": "有智能体正在工作",
  };

  it("resolves every iteration-127 key in both locales", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const enValue = mod.translate(key);
      expect(enValue, `en fallback leak: ${key}`).not.toBe(key);
      expect(enValue.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key), `zh mismatch: ${key}`).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("interpolates the connected-by line with the GitHub login", () => {
    expect(mod.translate("integrations.gh.connectedBy", { name: "acme" })).toBe(
      "Connected by acme",
    );
    mod.setLocale("zh");
    expect(mod.translate("integrations.gh.connectedBy", { name: "acme" })).toBe(
      "由 acme 连接",
    );
  });

  it("interpolates the disconnect confirmation with the account label", () => {
    mod.setLocale("zh");
    expect(
      mod.translate("integrations.gh.disconnectDesc", { label: "acme" }),
    ).toContain("acme");
  });

  it("keeps Connect and Disconnect distinct in both locales", () => {
    // A collapsed wording would make the destructive action read as the
    // constructive one on a confirmation dialog.
    for (const locale of ["en", "zh"] as const) {
      mod.setLocale(locale);
      const connect = mod.translate("integrations.gh.connectGithub");
      const disconnect = mod.translate("integrations.gh.disconnect");
      const confirm = mod.translate("integrations.gh.disconnectConfirm");
      expect(connect).not.toBe(disconnect);
      // The confirm action names the action, not a bare "OK".
      expect(confirm).toBe(disconnect);
    }
  });

  it("keeps the two squads scopes distinct", () => {
    for (const locale of ["en", "zh"] as const) {
      mod.setLocale(locale);
      expect(mod.translate("squads.scope.mine")).not.toBe(
        mod.translate("squads.scope.all"),
      );
    }
  });

  it("names the squads scope in the empty state, not just 'no data'", () => {
    // The scope-empty screen must say WHERE the list went (the active scope)
    // and how to get back — a bare "no squads" would contradict the badge.
    mod.setLocale("zh");
    expect(mod.translate("squads.scopeEmptyMine")).toContain("创建");
    expect(mod.translate("squads.scopeEmptyMineHint")).toContain("全部");
  });
});
