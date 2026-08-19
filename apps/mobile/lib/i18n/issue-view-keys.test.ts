import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-63 list/board view-toggle i18n (MYS-409).
// Same contract as every keys test: every key resolves in BOTH locales and
// the zh value is actually translated.
describe("issue list/board view i18n", () => {
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
    "issues.viewList": "列表",
    "issues.viewBoard": "看板",
    "issues.boardEmptyColumn": "无问题",
    "issues.cardDue": "截止",
    "issues.cardStart": "开始",
    "a11y.viewList": "列表视图",
    "a11y.viewBoard": "看板视图",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en).not.toBe(key); // en present (not the raw id fallback)
      expect(en.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      const zhValue = mod.translate(key);
      expect(zhValue).toBe(zh); // zh spot matches
      mod.setLocale("en");
    }
  });
});