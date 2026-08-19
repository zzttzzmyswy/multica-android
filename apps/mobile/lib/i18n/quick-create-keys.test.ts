import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-56 agent-mode quick-create i18n. Same
// contract as about-keys.test.ts: every key resolves in BOTH locales and
// the zh value is actually translated (not the en text echoed back).
describe("quick-create i18n", () => {
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
    "newIssue.modeManual": "手动填写",
    "newIssue.modeAgent": "通过智能体创建",
    "newIssue.agentPlaceholder": "用自然语言描述任务，agent 会帮你创建…",
    "newIssue.agentSelectAgent": "选择智能体",
    "newIssue.agentSentTitle": "任务已发送",
    "newIssue.agentSentBody": "任务已创建并交给 {{name}} 处理",
    "attr.agent": "智能体",
    "a11y.newIssueAgentPicker": "选择智能体或小队",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en).not.toBe(key); // en present (not the raw id fallback)
      expect(en.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      const actualZh = mod.translate(key);
      expect(actualZh).toBe(zh); // zh present and translated
      expect(actualZh).not.toBe(en); // not the en text echoed back
      mod.setLocale("en");
    }
  });

  it("interpolates {{name}} into the agent-sent body", () => {
    mod.setLocale("zh");
    expect(mod.translate("newIssue.agentSentBody", { name: "助手" })).toBe(
      "任务已创建并交给 助手 处理",
    );
  });
});