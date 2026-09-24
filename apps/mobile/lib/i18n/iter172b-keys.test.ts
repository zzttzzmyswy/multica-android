import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n spot-checks for iteration 172's S-group (the settings parity batch:
// label scope + search, profile about field). Same contract as
// iter119/…/iter172-keys.test.ts: every key resolves in BOTH locales and the
// zh value is a real translation, not the raw-id fallback.
//
// The zh strings are copied verbatim from views' `settings.json`
// (`labels.scopes` / `labels.search_placeholder` / `labels.empty` /
// `labels.editor.scope_hint` / `account.profile_description_*`). Both clients
// describe the same two catalogs and the same profile field to the same user,
// so the wording has to agree; `zh-cross-bundle.test.ts` holds the shared
// sources to exact agreement and this suite pins the English side.
describe("settings parity i18n (iteration 172 S-group)", () => {
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
    "labels.scope.issue": "任务",
    "labels.scope.skill": "Skill",
    "labels.searchPlaceholder": "按名称或描述筛选...",
    "labels.noResults": "没有匹配的标签",
    "labels.emptyScope": "暂无 {{scope}} 标签",
    "labels.form.scopeHint": "这个标签只属于 {{scope}} 分类。",
    "profile.aboutLabel": "关于你",
    "profile.aboutTooLong": "资料过长（最多 {{max}} 字符，当前 {{count}}）。",
  };

  it("resolves every S-group key in both locales", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const enValue = mod.translate(key);
      expect(enValue, `en fallback leak: ${key}`).not.toBe(key);
      expect(enValue.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key), `zh mismatch: ${key}`).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("uses the same English wording as the web settings surface", () => {
    mod.setLocale("en");
    expect(mod.translate("labels.scope.issue")).toBe("Issues");
    expect(mod.translate("labels.scope.skill")).toBe("Skills");
    expect(mod.translate("labels.searchPlaceholder")).toBe(
      "Filter by name or description...",
    );
    expect(mod.translate("labels.noResults")).toBe("No matching labels");
    expect(mod.translate("profile.aboutLabel")).toBe("About you");
  });

  it("interpolates the scope into the empty state and the editor hint", () => {
    // Both keys are rendered through `{{scope}}`; a missing placeholder would
    // render the literal braces to the user.
    mod.setLocale("en");
    const empty = mod.translate("labels.emptyScope", { scope: "Skills" });
    expect(empty).toBe("No Skills labels yet");
    const hint = mod.translate("labels.form.scopeHint", { scope: "Skills" });
    expect(hint).toBe("This label belongs only to the Skills catalog.");
    mod.setLocale("zh");
    expect(mod.translate("labels.emptyScope", { scope: "任务" })).toBe(
      "暂无 任务 标签",
    );
  });

  it("keeps the new scope keys distinct from the pre-existing labels.emptyTitle", () => {
    // `labels.emptyTitle` is the generic "No labels yet" used before the scope
    // control existed. Reusing it would drop the scope from the copy and make
    // an empty skill catalog read identically to an empty issue catalog.
    mod.setLocale("en");
    expect(mod.translate("labels.emptyScope", { scope: "Skills" })).not.toBe(
      mod.translate("labels.emptyTitle"),
    );
  });

  it("names the profile field differently from the workspace name field", () => {
    mod.setLocale("en");
    expect(mod.translate("profile.aboutLabel")).not.toBe(
      mod.translate("settings.name"),
    );
    mod.setLocale("zh");
    expect(mod.translate("profile.aboutLabel")).not.toBe(
      mod.translate("settings.name"),
    );
  });
});
