import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Iteration-246 inbox main-view filter i18n. The main list now opens the same
// filter sheet as the archived sub-view, so it needs its own heading and its
// own two states: the trigger's label (and its counted form), and the
// "filtered to nothing" copy. Same contract as inbox-archive-keys.test.ts:
// every key resolves in BOTH locales and the zh value is a real translation.
describe("inbox main-view filter i18n", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  async function loadI18n() {
    return await import("./index");
  }

  beforeEach(async () => {
    mod = await loadI18n();
    mod.resetI18nForTests();
    mod.setLocale("en");
  });

  const ZH: Record<string, string> = {
    "inbox.filterEmpty": "没有符合筛选条件的通知",
    "inbox.filters": "筛选收件箱",
    "inbox.filtersActive": "{{count}} 个筛选条件",
  };

  const EN: Record<string, string> = {
    "inbox.filterEmpty": "No notifications match your filters",
    "inbox.filters": "Filter inbox",
    "inbox.filtersActive": "{{count}} active filters",
  };

  it("resolves every key in both locales with a real translation", () => {
    for (const [key, zh] of Object.entries(ZH)) {
      expect(mod.translate(key), key).toBe(EN[key]);
      mod.setLocale("zh");
      expect(mod.translate(key), key).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("interpolates the count in the active-filter label", () => {
    // Reaches the user as a number on the trigger; an un-substituted
    // `{{count}}` is the kind of thing that only shows up on a device.
    for (const locale of ["en", "zh"] as const) {
      mod.setLocale(locale);
      const rendered = mod.translate("inbox.filtersActive", { count: 3 });
      expect(rendered).toContain("3");
      expect(rendered).not.toContain("{{");
    }
  });

  it("says something different from the zero state", () => {
    // The two empty states must not collapse into one sentence: "nothing
    // matches your filters" (rows exist, hidden) and "your inbox is empty"
    // (there is nothing) are different facts with different ways out.
    for (const locale of ["en", "zh"] as const) {
      mod.setLocale(locale);
      expect(mod.translate("inbox.filterEmpty")).not.toBe(
        mod.translate("inbox.zero"),
      );
    }
  });
});
