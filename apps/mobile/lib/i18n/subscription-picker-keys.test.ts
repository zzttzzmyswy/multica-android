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
 * Contract test for iteration-180's three surfaces: the subscriber picker
 * (G25), comment moderation (G23), and the issue metadata section (G26). Same
 * shape as actor-profile-keys.test.ts: every key resolves in BOTH locales — a
 * zh value proves the en key is real and vice versa — and the zh value is
 * actually translated rather than a copy of the English.
 *
 * `comment.moderateDeleteTitle` and the two aria strings carry `{{name}}` /
 * `{{count}}` interpolation, so they are asserted with parameters rather than
 * as bare literals: a bundle that dropped the placeholder would still resolve,
 * and the assertion below is what catches it.
 */
describe("subscriber picker + comment moderation + issue metadata i18n", () => {
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

  /** Keys whose value is a literal both locales must carry verbatim. */
  const LITERAL: Array<[string, string, string]> = [
    // [key, en, zh]
    ["subscription.picker.title", "Subscribers", "订阅者"],
    ["subscription.picker.searchPlaceholder", "Change subscribers...", "更改订阅者..."],
    ["subscription.picker.membersGroup", "Members", "成员"],
    ["subscription.picker.agentsGroup", "Agents", "智能体"],
    ["subscription.picker.empty", "No results found", "未找到结果"],
    ["subscription.picker.openAria", "Manage subscribers", "管理订阅者"],
    ["issue.metadata.sectionTitle", "Metadata", "元数据"],
  ];

  /** Keys with placeholders, asserted by rendering them. */
  const INTERPOLATED: Array<[string, Record<string, string | number>, string, string]> = [
    // [key, params, en, zh]
    [
      "subscription.picker.rowAriaSubscribed",
      { name: "Mika" },
      "Mika, subscribed. Tap to unsubscribe.",
      "Mika，已订阅。点击可取消订阅。",
    ],
    [
      "subscription.picker.rowAriaUnsubscribed",
      { name: "Mika" },
      "Mika, not subscribed. Tap to subscribe.",
      "Mika，未订阅。点击可订阅。",
    ],
    [
      "comment.moderateDeleteTitle",
      { name: "Ann" },
      "Delete Ann's comment?",
      "删除 Ann 的评论？",
    ],
    ["issue.metadata.count", { count: 3 }, "3 keys", "3 个键"],
  ];

  it("resolves every literal key in en", () => {
    for (const [key, en] of LITERAL) {
      expect(mod.translate(key), key).toBe(en);
    }
  });

  it("translates every literal key into zh", () => {
    mod.setLocale("zh");
    for (const [key, , zh] of LITERAL) {
      expect(mod.translate(key), key).toBe(zh);
    }
  });

  it("resolves every interpolated key with its placeholder filled", () => {
    for (const [key, params, en] of INTERPOLATED) {
      expect(mod.translate(key, params), key).toBe(en);
    }
  });

  it("translates every interpolated key into zh", () => {
    mod.setLocale("zh");
    for (const [key, params, , zh] of INTERPOLATED) {
      expect(mod.translate(key, params), key).toBe(zh);
    }
  });

  it("never leaves a placeholder unfilled", () => {
    // Stronger than comparing to a literal: catches a key that resolves but
    // silently drops the name, which would leave a screen-reader announcement
    // reading "not subscribed. Tap to subscribe." with no subject.
    for (const key of [
      "subscription.picker.rowAriaSubscribed",
      "subscription.picker.rowAriaUnsubscribed",
      "comment.moderateDeleteTitle",
    ]) {
      for (const locale of ["en", "zh"] as const) {
        mod.setLocale(locale);
        const out = mod.translate(key, { name: "Zoe" });
        expect(out, `${locale} ${key}`).toContain("Zoe");
        expect(out, `${locale} ${key}`).not.toContain("{{");
      }
    }
  });
});
