import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the agent no-access copy (MYS-2161).
//
// These three strings are the whole difference between the two faces on this
// route, so the zh values are pinned to web's `agents.json` wording verbatim
// rather than paraphrased: the same URL and the same state must produce the same
// claim on both clients, and a mobile-only rewording is how the two drift into
// disagreeing again. Web's originals:
//
//   detail.no_access_title       你没有访问该智能体的权限
//   detail.no_access_hint        只有该私密智能体的拥有者或工作区管理员可以查看。
//   detail.back_to_agents_full   返回智能体列表
//
// None of them may contain 不存在 / 删除 — that is the sentence this iteration
// removed, and its return would be the defect coming back under a new key.
describe("agent no-access i18n (MYS-2161)", () => {
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
    "agents.detail.noAccessTitle": "你没有访问该智能体的权限",
    "agents.detail.noAccessHint":
      "只有该私密智能体的拥有者或工作区管理员可以查看。",
    "agents.detail.noAccessBackToAgents": "返回智能体列表",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const key of Object.keys(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en, `${key} missing from en`).not.toBe(key);
      expect(en.length).toBeGreaterThan(0);
      // The en tag must not be the zh string copied across — that would satisfy
      // a presence check while shipping Chinese to an English reader.
      expect(/[一-鿿]/.test(en), `${key} en value contains CJK`).toBe(false);

      mod.setLocale("zh");
      expect(mod.translate(key), `${key} zh`).toBe(ZH_SPOT[key]);
      mod.setLocale("en");
    }
  });

  it("never re-states the not-found claim", () => {
    // The defect was not a missing string, it was a WRONG one: 「该智能体不存在
    // 或已被删除」 for an agent that exists. Whatever wording these keys carry
    // later, they must not drift back onto that claim.
    for (const key of Object.keys(ZH_SPOT)) {
      mod.setLocale("zh");
      const zh = mod.translate(key);
      for (const forbidden of ["不存在", "已被删除", "删除"]) {
        expect(zh, `${key} claims the agent is gone`).not.toContain(forbidden);
      }
      mod.setLocale("en");
    }
  });

  it("keeps the not-found copy itself unchanged", () => {
    // The other half of the pair: the no-access face is added BESIDE the
    // existing sentence, not by rewording it. A real 404 must keep saying what
    // it said before (iteration-25 copy, pinned in agents-keys.test.ts).
    mod.setLocale("zh");
    expect(mod.translate("agents.notFound")).toBe("该智能体不存在或已被删除");
  });
});
