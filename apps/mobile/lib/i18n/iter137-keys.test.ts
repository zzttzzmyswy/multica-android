import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n spot-checks for iteration 137 — the date sheet's quick picks, the
// Android date-row a11y label, and the copy-workdir action's four outcomes.
// Same contract as iter119/…/iter135-keys.test.ts: every key resolves in BOTH
// locales and the zh value is a real translation, not the raw-id fallback.
describe("iteration 137 i18n", () => {
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
    // Date-sheet quick picks, mirroring web's date submenu items.
    "datePicker.today": "今天",
    "datePicker.tomorrow": "明天",
    "datePicker.nextWeek": "下周",
    "datePicker.chooseDate": "选择日期",
    // Copy-workdir action + its three toasts (web issues.json detail.*).
    "issue.copyWorkdirPath": "复制本地 workdir 路径",
    "issue.workdirPathCopied": "已复制本地 workdir 路径",
    "issue.workdirPathCopyFailed": "复制本地 workdir 路径失败",
    "issue.workdirPathUnavailable":
      "暂无本地 workdir — 这个任务还没被本地智能体运行过",
    // Relations entry web has and the phone menu did not.
    "issueRelation.createChildTitle": "创建子任务",
  };

  it("resolves every new key in both locales, with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en, key).not.toBe(key);
      expect(en.length, key).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key), key).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("names the resolved day in the quick-pick a11y label", () => {
    // "Next week" alone does not tell a screen-reader user which day it lands
    // on, so the label carries both.
    const label = mod.translate("a11y.dateQuickPick", {
      label: "下周",
      date: "2026年9月24日",
    });
    expect(label).toContain("下周");
    expect(label).toContain("2026年9月24日");
    expect(label).not.toContain("{{");
  });

  it("keeps the workdir copy wording identical to web's", () => {
    // The three outcomes are ported verbatim from
    // packages/views/locales/zh-Hans/issues.json detail.* — a divergence here
    // would mean the two clients tell users different things about one failure.
    mod.setLocale("en");
    expect(mod.translate("issue.workdirPathUnavailable")).toBe(
      "No local workdir yet — issue has not been run by a local agent",
    );
    expect(mod.translate("issue.workdirPathCopied")).toBe("Workdir path copied");
    expect(mod.translate("issue.workdirPathCopyFailed")).toBe(
      "Failed to copy workdir path",
    );
    expect(mod.translate("issue.copyWorkdirPath")).toBe(
      "Copy local workdir path",
    );
  });

  it("keeps 创建子任务 distinct from 添加子任务", () => {
    // Web's Relations submenu offers both: one opens the create form with the
    // parent preset, the other searches for an existing issue. Collapsing them
    // to one wording would make the two menu rows indistinguishable.
    mod.setLocale("zh");
    expect(mod.translate("issueRelation.createChildTitle")).toBe("创建子任务");
    expect(mod.translate("issueRelation.addChildTitle")).toBe("添加子任务");
  });

  it("translates the date quick picks as UI labels, not calendar nouns", () => {
    // Guards against a translator reaching for 明天/下周 in a noun form; these
    // are tappable actions and must read as the bare day word.
    mod.setLocale("zh");
    expect(mod.translate("datePicker.today")).toBe("今天");
    expect(mod.translate("datePicker.tomorrow")).toBe("明天");
    expect(mod.translate("datePicker.nextWeek")).toBe("下周");
  });
});
