import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-247 runtime registration-failure copy (MYS-2175).
//
// Same contract as every keys test: the key resolves in BOTH locales, the en
// value is the real string (not the raw-id fallback), and the zh value is the
// exact Chinese copy.
//
// The string is web's own (`packages/views/locales/{en,zh-Hans}/runtimes.json`
// -> "Registration error" / "注册错误"). It has to stay distinct from the two
// neighbouring states it sits between: `pending_health` ("Registering with
// daemon") is the wait that has NOT failed, and `pending_health_warning`
// ("Waiting for daemon sync") is a wait that is merely slow. Collapsing any
// pair sends the user back to waiting for a runtime that either already gave
// up or is about to.
describe("runtime registration-failure i18n", () => {
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
    "runtimes.list.pending_health_error": "注册错误",
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

  it("matches upstream web's wording in both languages", () => {
    // Parity with the other client is the point of the key: the two surfaces
    // describe one server-side event, so a reworded copy here would make the
    // phone and web disagree about the same runtime.
    expect(mod.translate("runtimes.list.pending_health_error")).toBe(
      "Registration error",
    );
    mod.setLocale("zh");
    expect(mod.translate("runtimes.list.pending_health_error")).toBe("注册错误");
    mod.setLocale("en");
  });

  it("keeps the failure copy distinct from the waiting copy", () => {
    // The regression this guards: rendering "Registering with daemon" (or the
    // slow-sync warning) over a runtime whose registration already failed.
    const pairs: [string, string][] = [
      ["runtimes.list.pending_health_error", "runtimes.list.pending_health"],
      ["runtimes.list.pending_health_error", "runtimes.list.pending_health_warning"],
      ["runtimes.list.pending_health_error", "runtimes.list.pending_health_disabled"],
    ];
    for (const locale of ["en", "zh"] as const) {
      mod.setLocale(locale);
      for (const [failure, waiting] of pairs) {
        expect(mod.translate(failure)).not.toBe(mod.translate(waiting));
      }
    }
    mod.setLocale("en");
  });
});
