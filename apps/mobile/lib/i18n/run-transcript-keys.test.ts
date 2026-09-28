import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

/**
 * The iteration-183 run-transcript header and ⓘ panel keys.
 *
 * Same contract as every keys test in this directory: each key resolves in BOTH
 * locales, and the zh value is a real translation rather than the English one
 * echoed back. The trigger labels are held to a zh spot-check because they are
 * the strings a CN reader scans first, and a copy-paste of the en value there
 * would be invisible in an en-only test run.
 */
describe("run transcript i18n", () => {
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

  // Wording is copied from web's `agents.json` `transcript` namespace
  // (packages/views/locales/{en,zh-Hans}/agents.json) rather than re-translated,
  // so the two clients say the same thing.
  const ZH_SPOT: Record<string, string> = {
    "runs.transcript.triggerRetry": "重试",
    "runs.transcript.triggerComment": "评论触发",
    "runs.transcript.triggerAutopilot": "自动化",
    "runs.transcript.triggerChat": "来自对话",
    "runs.transcript.triggerQuickCreate": "快速创建",
    "runs.transcript.triggerDirect": "直接指派",
    "runs.transcript.triggerInitial": "初次运行",
    "runs.transcript.runInfo": "运行详情",
    "runs.transcript.detailsRuntime": "运行时",
    "runs.transcript.detailsProvider": "提供方",
    "runs.transcript.detailsMode": "模式",
    "runs.transcript.detailsWorkdir": "工作目录",
    "runs.transcript.detailsBranch": "分支",
    "runs.transcript.detailsReason": "原因",
    "runs.transcript.detailsCreated": "创建",
    "runs.transcript.detailsStarted": "开始",
    "runs.transcript.detailsCompleted": "完成",
    "runs.transcript.detailsInput": "输入",
    "runs.transcript.detailsOutput": "输出",
    "runs.transcript.detailsCacheRead": "缓存读",
    "runs.transcript.detailsCacheWrite": "缓存写",
    "runs.transcript.detailsCost": "费用",
    "runs.transcript.usageChip": "这次运行消耗的 token 与估算费用",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en, `${key} missing in en`).not.toBe(key);
      expect(en.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key), `${key} zh mismatch`).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("pluralizes the comment-coverage figure, which is the only counted key", () => {
    // The count is gated at `> 1` upstream, so the `_one` form exists for
    // locale completeness rather than for a reachable UI state — but a missing
    // plural form is a hard i18next error, not a fallback.
    expect(mod.translate("runs.transcript.includedComments", { count: 3 })).toContain("3");
    expect(mod.translate("runs.transcript.includedComments", { count: 3 })).not.toBe(
      "runs.transcript.includedComments",
    );
  });
});
