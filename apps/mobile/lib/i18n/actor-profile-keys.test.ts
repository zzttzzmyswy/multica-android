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
 * Contract test for the iteration-179 actor profile cards (G14) and the
 * issue-level reaction entry point (G19). Same shape as squads-keys.test.ts:
 * every key resolves in BOTH locales — a zh value proves the en key is real
 * and vice versa — and the zh value is actually translated rather than a copy
 * of the English.
 *
 * The plural pairs are enumerated on purpose. `translate()` does no plural
 * resolution, so `countLabelKey` picks `_one` / `_other` at the call site; a
 * bundle that ships only one of the two forms renders a raw key id for the
 * other count. The zh bundle legitimately omits the `_one` forms (Chinese has
 * no plural), which `translate()` covers by falling back to the en value —
 * asserted below rather than assumed.
 */
describe("actor profile cards + issue reaction i18n", () => {
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
    "profileCard.title": "资料",
    "profileCard.detailLink": "详情",
    "profileCard.openAria": "查看 {{name}} 的资料",
    "profileCard.archived": "已归档",
    "profileCard.unavailable.member": "成员信息不可用",
    "profileCard.unavailable.agent": "智能体不可用",
    "profileCard.unavailable.squad": "小队不可用",
    "profileCard.ownedAgents": "智能体（{{count}}）",
    "profileCard.moreAgents_other": "另有 {{count}} 个智能体",
    "profileCard.runtimeLabel": "运行时",
    "profileCard.modelLabel": "模型",
    "profileCard.modelUnset": "运行时默认",
    "profileCard.skillsLabel": "Skills",
    "profileCard.ownerLabel": "所有者",
    "profileCard.unknownRuntime": "未知运行时",
    "profileCard.fallbackRuntimeCloud": "云端",
    "profileCard.fallbackRuntimeLocal": "本地",
    "profileCard.membersSection": "成员",
    "profileCard.moreMembers_other": "还有 {{count}} 人",
    "profileCard.leaderChip": "队长",
    "issue.reaction.add": "添加表情",
    "issue.reaction.quickPick": "选一个表情",
    "issue.reaction.moreEmojis": "更多表情…",
  };

  it("translates every new key into zh", () => {
    mod.setLocale("zh");
    for (const [key, value] of Object.entries(ZH_SPOT)) {
      expect(mod.translate(key), key).toBe(value);
    }
  });

  it("resolves every new key in en too", () => {
    for (const key of Object.keys(ZH_SPOT)) {
      const value = mod.translate(key);
      expect(value, key).not.toBe(key);
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
  });

  it("keeps the plural pairs resolvable in both locales", () => {
    const pairs = [
      ["profileCard.moreAgents_one", "profileCard.moreAgents_other"],
      ["profileCard.moreMembers_one", "profileCard.moreMembers_other"],
    ] as const;
    for (const locale of ["en", "zh"] as const) {
      mod.setLocale(locale);
      for (const [one, other] of pairs) {
        expect(mod.translate(one), `${locale} ${one}`).not.toBe(one);
        expect(mod.translate(other), `${locale} ${other}`).not.toBe(other);
      }
    }
  });

  it("interpolates the count into the plural strings", () => {
    mod.setLocale("en");
    expect(mod.translate("profileCard.moreAgents_other", { count: 3 })).toBe(
      "and 3 other agents",
    );
    expect(mod.translate("profileCard.moreMembers_other", { count: 4 })).toBe(
      "+4 more",
    );
    expect(mod.translate("profileCard.openAria", { name: "Mika" })).toBe(
      "View Mika's profile",
    );
    mod.setLocale("zh");
    expect(mod.translate("profileCard.openAria", { name: "Mika" })).toBe(
      "查看 Mika 的资料",
    );
  });
});
