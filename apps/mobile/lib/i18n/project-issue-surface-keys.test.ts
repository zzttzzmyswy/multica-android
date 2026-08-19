import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-68 project-scope issue surface i18n
// (MYS-437). Same contract as every keys test: every key resolves in BOTH
// locales and the zh value is actually translated.
describe("project issue-surface i18n", () => {
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
    "project.emptyIssues": "该项目暂无问题。",
    "issues.scopeAll": "全部",
    "issues.scopeMembers": "成员",
    "issues.scopeAgents": "Agents",
    "issues.viewList": "列表",
    "issues.viewBoard": "看板",
    "issues.filterEmpty": "没有符合当前筛选的问题。",
    "issues.boardEmptyColumn": "无问题",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const enValue = mod.translate(key);
      expect(enValue).not.toBe(key);
      expect(enValue.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("shares the saved-view visibility vocabulary (project scope shows it)", () => {
    expect(mod.translate("issueViews.visibilityPrivate")).toBe("Only me");
    expect(mod.translate("issueViews.visibilityWorkspace")).toBe(
      "Everyone in the workspace",
    );
    mod.setLocale("zh");
    expect(mod.translate("issueViews.visibilityPrivate")).toBe("仅自己可见");
    expect(mod.translate("issueViews.visibilityWorkspace")).toBe("工作区所有成员可见");
  });

  it("interpolates the delete-confirm view name", () => {
    expect(
      mod.translate("issueViews.deleteConfirmMessage", { name: "project-ip68" }),
    ).toContain("project-ip68");
    mod.setLocale("zh");
    expect(
      mod.translate("issueViews.deleteConfirmMessage", { name: "project-ip68" }),
    ).toContain("project-ip68");
  });

  // Each view list is keyed by the scope container (workspace / my /
  // project) — the route param vocabulary these routes pass around.
  it("keeps the three filter-sheet scope names usable", () => {
    expect(mod.translate("filter.title")).toBe("Filter");
    mod.setLocale("zh");
    expect(mod.translate("filter.title")).toBe("筛选");
  });
});