import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-194 catalog four-state copy (MYS-1907).
//
// Same contract as every keys test: each key resolves in BOTH locales, the en
// value is the real string (not the raw-id fallback), and the zh value is the
// exact Chinese copy. The two strings added here are what the shared status
// painter and the property-filter options list say when a read failed or a
// definition has no options — both replacing sentences that asserted something
// false.
describe("catalog four-state i18n", () => {
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
    // The generic failure line. It must stand on its own: the property
    // management page's `properties.loadError` ends in a colon because that
    // page appends `error.message`, so it cannot be reused here.
    "catalog.loadError": "列表加载失败",
    // FilterPropertyPickerBody has no search box, so "no matches" was never
    // true there; this names the fact it is actually showing.
    "filter.propertyNoOptions": "该属性暂无可选项",
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

  it("keeps the failure line free of a dangling colon", () => {
    // `properties.loadError` is prefixed to `error.message` by the management
    // page, so it ends in a colon. A status painter renders the string alone;
    // reusing that key is how MYS-1892 shipped 「加载属性失败：」 with nothing
    // after it. Asserted on the value, not just the key name.
    mod.setLocale("zh");
    expect(mod.translate("catalog.loadError")).not.toMatch(/[：:]\s*$/);
    mod.setLocale("en");
    expect(mod.translate("catalog.loadError")).not.toMatch(/:\s*$/);
  });
});
