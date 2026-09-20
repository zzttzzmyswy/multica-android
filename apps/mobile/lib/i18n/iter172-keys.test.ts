import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n spot-checks for iteration 172 — the chat-window parity batch (message
// windowing, list stop, quick-actions refresh). Same contract as
// iter119/…/iter171-keys.test.ts: every key resolves in BOTH locales and the
// zh value is a real translation, not the raw-id fallback.
//
// The zh strings are copied verbatim from views' `chat.json`
// (`message_list.*` / `session_history.*`). That matters beyond tidiness: the
// phone and the web app describe the same two actions to the same user, and
// `zh-cross-bundle.test.ts` now holds these nine shared sources to exact
// agreement — this suite pins the English side so a rename cannot make both
// sides agree on the wrong string.
describe("chat window parity i18n (iteration 172)", () => {
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
    "chat.loadingOlder": "正在加载更早的消息…",
    "chat.olderLoadFailed": "无法加载更早的消息。",
    "chat.quickActionsHeading": "后续提问",
    "chat.regenerateQuickActions": "重新生成建议",
    "chat.regenerateQuickActionsFailed": "无法重新生成建议，请重试。",
    "chat.stop": "停止",
    "chat.stopDialogTitle": "停止这次运行？",
    "chat.stopDialogCancel": "继续运行",
    "chat.stopDialogConfirm": "停止运行",
    "chat.stopping": "停止中...",
  };

  it("resolves every iteration-172 key in both locales", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const enValue = mod.translate(key);
      expect(enValue, `en fallback leak: ${key}`).not.toBe(key);
      expect(enValue.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key), `zh mismatch: ${key}`).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("uses the same English wording as the web chat surface", () => {
    // packages/views/locales/en/chat.json message_list.* / session_history.*
    mod.setLocale("en");
    expect(mod.translate("chat.loadingOlder")).toBe("Loading older messages…");
    expect(mod.translate("chat.quickActionsHeading")).toBe("Follow-up questions");
    expect(mod.translate("chat.regenerateQuickActions")).toBe(
      "Regenerate suggestions",
    );
    expect(mod.translate("chat.stop")).toBe("Stop");
    expect(mod.translate("chat.stopDialogTitle")).toBe("Stop this run?");
    expect(mod.translate("chat.stopDialogCancel")).toBe("Keep running");
    expect(mod.translate("chat.stopDialogConfirm")).toBe("Stop run");
    expect(mod.translate("chat.stopping")).toBe("Stopping...");
  });

  it("keeps the stop action distinct from the existing stop-agent label", () => {
    // `chat.stopAgent` ("Stop agent") already existed for a different action —
    // ending the agent's availability, not cancelling one run. Reusing it
    // would make two different destructive actions read identically.
    mod.setLocale("en");
    expect(mod.translate("chat.stop")).not.toBe(mod.translate("chat.stopAgent"));
    mod.setLocale("zh");
    expect(mod.translate("chat.stop")).not.toBe(mod.translate("chat.stopAgent"));
  });
});
