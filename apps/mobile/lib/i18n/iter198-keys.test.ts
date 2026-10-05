import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-198 chat availability copy (MYS-1924, gap 1).
//
// Same contract as every keys test: each key resolves in BOTH locales, the en
// value is the real string (not the raw-id fallback), and the zh value is the
// exact Chinese copy.
//
// The two strings here are the ones the chat tab shows when the agent list
// could not be read. They exist because the failure used to render the
// *no-agent* copy instead — 「暂无可用智能体」 plus 「请在更多 → 智能体中添加或启用
// 智能体后开始聊天。」 — over a workspace that had agents, while the composer was
// disabled on the same value. The two pairs must stay distinct: collapsing them
// is exactly how a failed read goes back to claiming an absence.
describe("chat availability i18n", () => {
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
    "chat.agentsUnavailableTitle": "无法加载智能体列表",
    "chat.agentsUnavailableBody":
      "智能体列表加载失败，无法确认此工作区是否有可用智能体。",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en).not.toBe(key); // en present (not the raw id fallback)
      expect(en.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("keeps the failure copy distinct from the no-agent copy", () => {
    // A user who sees the failure sentence must not be told to go create an
    // agent: that is the advice the bug shipped, and it sends them to a screen
    // whose list is exactly what could not be read.
    for (const locale of ["en", "zh"] as const) {
      mod.setLocale(locale);
      expect(mod.translate("chat.agentsUnavailableTitle")).not.toBe(
        mod.translate("chat.noAgentsTitle"),
      );
      expect(mod.translate("chat.agentsUnavailableBody")).not.toBe(
        mod.translate("chat.noAgentsBody"),
      );
    }
    mod.setLocale("en");
  });

  it("does not promise that the workspace has no agents", () => {
    // The distinction the whole gap rests on: we do not know, and the copy must
    // say so rather than assert an absence.
    mod.setLocale("zh");
    expect(mod.translate("chat.agentsUnavailableTitle")).not.toContain("暂无");
    mod.setLocale("en");
    expect(mod.translate("chat.agentsUnavailableTitle").toLowerCase()).not.toContain(
      "no agents",
    );
  });
});
