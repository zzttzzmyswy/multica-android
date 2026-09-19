import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n spot-checks for iteration 167 — the machine-detail runtime row's new
// facts. Same contract as iter119/…/iter166-keys.test.ts: every key resolves in
// BOTH locales and the zh value is a real translation, not the raw-id fallback.
//
// `runtimes.row.taskCount` is the load-bearing one: mobile's `translate()` does
// no plural resolution, so a web-style `task_count_one` / `task_count_other`
// pair would never be looked up and the health line would print the raw id.
describe("machine runtime row i18n (iteration 167)", () => {
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
    "runtimes.row.actions": "行操作",
    "runtimes.row.delete": "删除",
    "runtimes.row.deleteProfile": "从工作区删除",
    "runtimes.row.taskCount": "{{count}} 个 task",
    "runtimes.row.costFlat": "持平",
  };

  it("resolves every iteration-167 key in both locales", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const enValue = mod.translate(key);
      expect(enValue, `en fallback leak: ${key}`).not.toBe(key);
      expect(enValue.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("interpolates the row's task count", () => {
    mod.setLocale("en");
    expect(mod.translate("runtimes.row.taskCount", { count: 2 })).toBe("2 tasks");
    mod.setLocale("zh");
    expect(mod.translate("runtimes.row.taskCount", { count: 2 })).toBe("2 个 task");
  });

  it("mirrors the web row vocabulary", () => {
    // packages/views/locales/{en,zh-Hans}/runtimes.json list.row_actions_aria,
    // list.delete_action, list.delete_profile_action, list.cost_delta_flat and
    // agents.json row.task_count — the phone must not invent a second
    // vocabulary for the same facts.
    mod.setLocale("en");
    expect(mod.translate("runtimes.row.actions")).toBe("Row actions");
    expect(mod.translate("runtimes.row.delete")).toBe("Delete");
    expect(mod.translate("runtimes.row.deleteProfile")).toBe(
      "Delete from workspace",
    );
    expect(mod.translate("runtimes.row.costFlat")).toBe("flat");
  });

  it("reuses the detail page's delete copy rather than restating it", () => {
    // The row menu runs the same flow as the detail page, so the cascade
    // warning, self-heal hint and conflict retry must be the same strings.
    mod.setLocale("en");
    expect(mod.translate("runtimes.detail.deleteConfirmTitle")).toBe(
      "Delete runtime?",
    );
    expect(mod.translate("runtimes.detail.deleteButton")).toBe("Delete runtime");
    expect(mod.translate("runtimes.detail.ownerUnknown")).toBe("—");
  });
});
