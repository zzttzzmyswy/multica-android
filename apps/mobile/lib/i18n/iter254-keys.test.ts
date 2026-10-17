import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for iteration 254's two "reading an actor name" strings
// (MYS-2215).
//
// Both are header labels: a swimlane's assignee lane title and a board's
// assignee column title. Unlike a table cell, a header cannot be blank — it is
// the row's only label, and an unlabelled lane reads as a rendering bug. So the
// unsettled state gets a neutral "reading" mark instead of nothing.
//
// What it must NEVER be is a name. `getName`'s "Unknown Agent" is the string
// this whole round exists to keep off screen; a locale rewrite that put the
// word back, under a new key, would restore the defect with the tests green.
describe("actor-name reading-state i18n", () => {
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
    "issues.swimlane.loadingLane": "读取中…",
    "issues.boardReadingAssignee": "读取中…",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en).not.toBe(key);
      expect(en.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("describes a read in progress, in both languages", () => {
    expect(mod.translate("issues.swimlane.loadingLane")).toBe("Reading…");
    mod.setLocale("zh");
    expect(mod.translate("issues.swimlane.loadingLane")).toContain("读取");
  });

  it("never says 'Unknown' or names an absence", () => {
    // The two failure modes this string must not have: a sentinel (a name
    // asserted from an unanswered read) and an absence (「未指派」, which claims
    // the issue has nobody when the truth is nobody has been looked up).
    for (const key of Object.keys(ZH_SPOT)) {
      expect(mod.translate(key)).not.toMatch(/Unknown/);
      expect(mod.translate(key)).not.toMatch(/Unassigned/i);
      mod.setLocale("zh");
      expect(mod.translate(key)).not.toMatch(/未知/);
      expect(mod.translate(key)).not.toMatch(/未指派/);
      expect(mod.translate(key)).not.toMatch(/无/);
      mod.setLocale("en");
    }
  });
});
