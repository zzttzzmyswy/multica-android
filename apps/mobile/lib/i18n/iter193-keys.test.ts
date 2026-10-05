import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-193 view-bar copy (MYS-1916).
//
// Both strings replace a sentence that asserted something false. The bar had
// exactly one empty message (`issueViews.noViews`, "no saved views yet"), so a
// preference document that hid every view — and a views read that had failed —
// both rendered it. Each of those is a different fact about the same slot, so
// each gets its own words.
describe("view-bar four-state i18n (MYS-1916)", () => {
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
    // Views exist; the bar preference is what keeps them out of sight. The
    // "no saved views yet" sentence would be a different, wrong claim.
    "issueViews.allHidden": "已保存的视图全部被隐藏。用\"调整顺序\"按钮重新显示。",
    // A FAILED preference read is not "you have no customization", and it is
    // what the write guard keys off — so the user is owed the reason their
    // hides and order are showing as default.
    "issueViews.prefsLoadError": "未能加载视图栏布局——已按默认顺序显示全部视图。",
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

  it("keeps the all-hidden copy distinct from the no-views copy", () => {
    // Two different facts, two different sentences — collapsing them back into
    // one key is how the false claim returns.
    for (const locale of ["en", "zh"] as const) {
      mod.setLocale(locale);
      expect(mod.translate("issueViews.allHidden")).not.toBe(
        mod.translate("issueViews.noViews"),
      );
    }
    mod.setLocale("en");
  });
});
