import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n for the issue-detail pull-request section (MYS-526). Same contract as
// the other *-keys tests: every key resolves in BOTH locales, and the zh
// value is actually translated (spot-checked, using web's zh-Hans copy).
describe("pull-request section i18n", () => {
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
    "pullRequest.sectionTitle": "Pull Request",
    "pullRequest.loading": "加载中...",
    "pullRequest.empty":
      "还没有关联的 PR。在 PR 的分支名、标题或正文里引用本任务的 identifier 即可自动关联。",
    "pullRequest.showMore": "显示其余 {{count}} 条",
    "pullRequest.showLess": "收起",
    "pullRequest.stateOpen": "Open",
    "pullRequest.stateDraft": "Draft",
    "pullRequest.stateMerged": "Merged",
    "pullRequest.stateClosed": "Closed",
    "pullRequest.checksNone": "暂无检查",
    "pullRequest.checksAllPassed": "全部检查通过（{{total}}/{{total}}）",
    "pullRequest.checksRunning": "{{passed}}/{{total}} · {{running}} 个进行中",
    "pullRequest.checksFailedCount": "{{failed}}/{{total}} 失败",
    "pullRequest.checksFailedNamed": "{{failed}}/{{total}} 失败 · {{names}}",
    "pullRequest.checksMore": "+{{count}} 个",
    "pullRequest.mergeConflicting": "存在合并冲突",
    "pullRequest.mergeReady": "可以合入",
    "pullRequest.mergeBlocked": "被阻止",
    "pullRequest.mergeBehind": "落后于基础分支",
    "pullRequest.mergeUnstable": "不稳定",
    "pullRequest.mergeHasHooks": "存在钩子",
    "pullRequest.snapshotStale": "更新于 {{time}}",
    "pullRequest.snapshotStaleUnknown": "快照可能已过期",
    "pullRequest.filesCount": "{{count}} 个文件",
  };

  it("resolves every PR key in both locales with the expected zh value", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en).not.toBe(key);
      expect(en).toBeTruthy();
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("interpolates count/time params in both locales", () => {
    mod.setLocale("en");
    expect(mod.translate("pullRequest.showMore", { count: 2 })).toBe("Show 2 more");
    expect(mod.translate("pullRequest.filesCount", { count: 6 })).toBe("6 files");
    expect(mod.translate("pullRequest.checksRunning", { passed: 5, total: 7, running: 2 })).toBe(
      "5/7 · 2 running",
    );
    mod.setLocale("zh");
    expect(mod.translate("pullRequest.showMore", { count: 2 })).toBe("显示其余 2 条");
    expect(mod.translate("pullRequest.filesCount", { count: 6 })).toBe("6 个文件");
    expect(mod.translate("pullRequest.snapshotStale", { time: "3h ago" })).toBe(
      "更新于 3h ago",
    );
  });
});