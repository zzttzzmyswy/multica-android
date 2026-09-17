import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n spot-checks for iteration 123: the autopilot run-history parity keys
// (skipped group + run-only execution log + load more) and the reply-mode
// thread-resolution keys. Same contract as iter119/iter120/iter122-keys.test.ts:
// every key resolves in BOTH locales (a zh value proves the en key is real,
// and vice versa) and the zh value is actually translated — not the raw id
// fallback.
describe("autopilot run history + thread resolution i18n (MYS-1043)", () => {
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
    // Root-thread actions keep web's action phrasing: the old zh strings
    // ("已解决" / "取消已解决") read as a state, not a command, next to the
    // reply-mode labels added below.
    "menu.resolveThread": "解决该讨论",
    "menu.unresolveThread": "重新打开讨论",
    "autopilots.runSkippedGroup.label": "已跳过",
    "autopilots.runSkippedGroup.summary": "{{count}} 条跳过的运行",
    "autopilots.runViewLog": "查看执行日志",
    "autopilots.detail.loadMoreRuns": "加载更多运行记录",
    "comment.resolveWithComment": "以此评论解决讨论",
    "comment.unresolve": "重新打开",
    "comment.resolutionBadge": "结论",
    "comment.foldBar": "{{count}} {{messageCount}} · {{authors}}",
    "comment.foldBarLabel":
      "{{count}} {{messageCount}}，作者 {{authors}}。点按展开。",
  };

  it("resolves every iteration-123 key in both locales", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const enValue = mod.translate(key);
      expect(enValue, `en fallback leak: ${key}`).not.toBe(key);
      expect(enValue.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("interpolates the skipped-run count in both locales", () => {
    mod.setLocale("en");
    expect(
      mod.translate("autopilots.runSkippedGroup.summary", { count: 7 }),
    ).toBe("7 skipped runs");
    mod.setLocale("zh");
    expect(
      mod.translate("autopilots.runSkippedGroup.summary", { count: 7 }),
    ).toBe("7 条跳过的运行");
  });

  it("interpolates the folded-reply bar in both locales", () => {
    mod.setLocale("en");
    expect(
      mod.translate("comment.foldBar", {
        count: 2,
        messageCount: "messages",
        authors: "Ann, Bob",
      }),
    ).toBe("2 messages by Ann, Bob");
    mod.setLocale("zh");
    expect(
      mod.translate("comment.foldBar", {
        count: 2,
        messageCount: "条消息",
        authors: "Ann、Bob",
      }),
    ).toBe("2 条消息 · Ann、Bob");
  });
});
