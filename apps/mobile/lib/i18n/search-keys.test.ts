import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n parity for the search screen keys. Same contract as every keys test:
// every key resolves in BOTH locales and the zh value is actually translated
// (symmetry + no raw fallback). Covers the iteration-89 `search.members`
// section plus the pre-existing search keys so the whole group stays aligned.
describe("search i18n", () => {
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
    "search.recent": "最近",
    "search.projects": "项目",
    "search.issues": "问题",
    "search.cancelled": "已取消",
    "search.members": "成员",
    "search.placeholder": "搜索问题和项目",
    "search.noResults": "未找到「{{query}}」的结果",
    "search.empty": "输入以搜索问题和项目。",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    const keys = Object.keys(ZH_SPOT);
    for (const key of keys) {
      const en = mod.translate(key);
      expect(en).not.toBe(key); // en present (not the raw id fallback)
      expect(en.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      const zhValue = mod.translate(key);
      expect(zhValue).toBe(ZH_SPOT[key]); // zh spot matches
      mod.setLocale("en");
    }
  });
});