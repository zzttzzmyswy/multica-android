import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-251 supporting-data degradation copy (MYS-2192).
//
// Same contract as every keys test: the key resolves in BOTH locales, the en
// value is the real string (not the raw-id fallback), and the zh value is the
// exact Chinese copy.
//
// The two banner strings are web's own, verbatim — `packages/views/locales/
// {en,zh-Hans}/skills.json` → `page.supporting_data_warning` and
// `detail.supporting_data_warning`. They must stay distinct from each other:
// the list says the affected fields "may appear incomplete", the detail page
// adds "until the next refresh", and collapsing them would lose the one
// sentence that tells a user on the detail page whether waiting helps.
describe("skills supporting-data degradation i18n", () => {
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
    "skills.list.supportingDataWarning":
      "部分工作区数据加载失败。创建者归属、运行时名称、编辑权限可能显示不完整。",
    "skills.detail.supportingDataWarning":
      "部分工作区数据加载失败。创建者归属、运行时名称、编辑权限可能要等下次刷新才完整。",
    "skills.list.usedByUnknown": "使用情况未知",
    "skills.usedBy.titlePlain": "被谁使用",
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

  it("matches upstream web's banner wording in both languages", () => {
    // Parity with the other client is the point of these two keys: they
    // describe one server-side failure, so a reworded copy here would make the
    // phone and web disagree about what a degraded skills page means.
    expect(mod.translate("skills.list.supportingDataWarning")).toBe(
      "Some workspace data failed to load. Creator attribution, runtime names, or edit permissions may appear incomplete.",
    );
    expect(mod.translate("skills.detail.supportingDataWarning")).toBe(
      "Some workspace data failed to load. Creator attribution, runtime names, or edit permissions may appear incomplete until the next refresh.",
    );
    mod.setLocale("zh");
    expect(mod.translate("skills.list.supportingDataWarning")).toBe(
      "部分工作区数据加载失败。创建者归属、运行时名称、编辑权限可能显示不完整。",
    );
    expect(mod.translate("skills.detail.supportingDataWarning")).toBe(
      "部分工作区数据加载失败。创建者归属、运行时名称、编辑权限可能要等下次刷新才完整。",
    );
    mod.setLocale("en");
  });

  it("keeps the degraded copy distinct from the conclusion it replaces", () => {
    // The regression this guards: rendering 「未使用」 — a fact — where the
    // read had not answered. The unknown wording must never be the same string
    // as the unused one, or the banner would be explaining a claim that still
    // reads as certain.
    for (const locale of ["en", "zh"] as const) {
      mod.setLocale(locale);
      expect(mod.translate("skills.list.usedByUnknown")).not.toBe(
        mod.translate("skills.list.unused"),
      );
      expect(mod.translate("skills.list.usedByUnknown")).not.toBe(
        mod.translate("skills.list.usageUnused"),
      );
    }
    mod.setLocale("en");
  });

  it("keeps the count-less section title distinct from the counted ones", () => {
    // `titlePlain` labels the Used-by section while its count is unknown. It
    // must not collide with the count-bearing strings, which interpolate
    // `{{count}}` and would render a literal placeholder without it.
    for (const locale of ["en", "zh"] as const) {
      mod.setLocale(locale);
      const plain = mod.translate("skills.usedBy.titlePlain");
      expect(plain).not.toContain("{{count}}");
      expect(plain).not.toBe(mod.translate("skills.usedBy.title"));
    }
    mod.setLocale("en");
  });
});
