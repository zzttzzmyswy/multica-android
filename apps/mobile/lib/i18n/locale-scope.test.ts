/**
 * Scope ratchet: the MOBILE app ships exactly two languages — Simplified
 * Chinese and English (owner decision, 2026-11-03, MYS-2580).
 *
 * This is a deliberate divergence from web, which also ships ja / ko / zh-Hant
 * (`packages/views/locales/`). Mobile does not, and must not grow them by
 * accident: the app already has the infrastructure to make a third language
 * look plausible — `AppLocale` is a union, `LANGUAGE_OPTIONS` drives the
 * settings picker, and the server accepts `ko` / `ja` / `zh-Hant` in
 * `user.language`. Nothing in the type system stops someone from adding a
 * bundle or an option and believing the work is done.
 *
 * The three assertions are the three ways a third locale could actually reach
 * a user, so a failure here names the real regression:
 *   1. a dictionary file — adding `ja.json` is the obvious first move;
 *   2. `SUPPORTED_LOCALES` — the value the app treats as its language surface;
 *   3. `LANGUAGE_OPTIONS` — the list the settings picker renders, i.e. what a
 *      member can actually pick.
 *
 * The `user.language` value the server accepts is intentionally NOT pinned to
 * two: that is a server-side contract shared with web, and narrowing it here
 * would break accounts whose stored preference is `ja`. The constraint is on
 * what MOBILE renders, not on what the API tolerates.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

const LOCALES_DIR = path.resolve(__dirname, "locales");

describe("mobile ships exactly zh + en", () => {
  it("has no dictionary beyond the two the app supports", () => {
    const dicts = readdirSync(LOCALES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    expect(dicts).toEqual(["en", "zh"]);
  });

  it("declares only zh and en as supported locales", async () => {
    const { SUPPORTED_LOCALES } = await import("./index");
    expect([...SUPPORTED_LOCALES].sort()).toEqual(["en", "zh"]);
  });

  it("offers only system / zh / en in the settings picker", async () => {
    const { LANGUAGE_OPTIONS } = await import("../settings-language");
    expect(LANGUAGE_OPTIONS.map((o) => o.id)).toEqual(["system", "zh", "en"]);
  });

  it("maps the locale union to exactly two Intl tags", async () => {
    const { getIntlLocale } = await import("./index");
    // The other direction of the same rule: no `en-US`-style tag can be
    // produced for a language the app does not ship.
    expect(getIntlLocale("zh")).toBe("zh-CN");
    expect(getIntlLocale("en")).toBe("en-US");
  });
});
