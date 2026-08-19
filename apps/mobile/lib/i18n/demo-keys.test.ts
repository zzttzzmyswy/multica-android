import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Pre-auth demo page (app/(auth)/demo.tsx) i18n. Same contract as the other
// <domain>-keys tests: every key resolves in BOTH locales and the zh value
// is actually translated.
describe("demo page i18n", () => {
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
    "demo.title": "产品演示",
    "demo.close": "关闭演示",
    "demo.hero.heading": "认识你的新同事：会干活的 AI 智能体",
    "demo.login.entry": "查看产品演示",
    "demo.section.agents.title": "会自己推进的任务",
    "demo.issue.tapHint": "点按切换",
    "demo.unassigned": "未分配",
    "demo.section.inbox.title": "你睡觉时也在工作的收件箱",
    "demo.section.chat.title": "和智能体对话",
    "demo.chat.working": "Claude 正在工作中…",
    "demo.section.run.title": "实时围观每一次执行",
    "demo.run.header": "智能体运行中",
    "demo.run.toolCalls": "次工具调用",
    "demo.run.taskHeader": "子任务执行历史",
    "demo.footer.title": "用自己的数据体验一下",
    "demo.footer.cta": "登录 Multica",
    "demo.footer.hint": "登录只要一分钟——输入邮箱和验证码即可。",
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

  it("does not leak raw ids for any demo.* key in either locale", () => {
    const enDict = require("./locales/en.json") as Record<string, string>;
    for (const key of Object.keys(enDict)) {
      if (!key.startsWith("demo.")) continue;
      expect(mod.translate(key)).not.toBe(key);
      mod.setLocale("zh");
      expect(mod.translate(key)).not.toBe(key);
      mod.setLocale("en");
    }
  });
});