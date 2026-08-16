import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Iteration-43 issue-subscription i18n. Same contract as mcp-keys.test.ts:
// every key resolves in BOTH locales and the zh value is actually translated.
describe("issue subscription i18n", () => {
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
    "subscription.subscribe": "订阅",
    "subscription.unsubscribe": "取消订阅",
    "subscription.unsubscribeThis": "取消订阅本问题",
    "subscription.unsubscribeSubtree": "取消订阅本问题及子任务",
    "subscription.delegatedBadge": "由 agent 代为关注",
    "subscription.delegatedHintTitle": "为什么你在关注",
    "subscription.updateFailedTitle": "订阅更新失败",
    "subscription.updateFailed": "无法更新订阅状态，请重试。",
    "subscription.unsubscribeSubtreeFailedTitle": "退订失败",
    "subscription.unsubscribeSubtreeFailed": "无法退订本问题及其子任务，请重试。",
    "runs.retry": "重试",
    "runs.retryTitle": "重试执行",
    "runs.retryRunning": "重试中…",
    "runs.retryFailed": "重试失败，可能任务已启动或 agent 不可用。",
    "runs.retryBlocked": "你没有权限触发该 agent。",
  };

  it("resolves every subscription key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const enValue = mod.translate(key);
      expect(enValue).not.toBe(key);
      expect(enValue.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zh);
      mod.setLocale("en");
    }
  });
});