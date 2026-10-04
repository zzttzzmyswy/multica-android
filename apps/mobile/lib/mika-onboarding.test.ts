/**
 * Mika's onboarding payload. Web parity target:
 * `packages/views/onboarding/templates/mika.ts` and `pickContentLang`
 * (`packages/views/onboarding/templates/index.ts:29-35`).
 *
 * The title is client-side (it names a session in the member's own language);
 * everything that defines Mika is server-side, so there is deliberately no
 * name/description/instructions field to assert here — the guard below pins
 * that they stay absent.
 */
import { describe, expect, it } from "vitest";
import { getMikaOnboarding, pickMikaContentLang } from "./mika-onboarding";

describe("pickMikaContentLang", () => {
  it("maps both app locales to their content language", () => {
    expect(pickMikaContentLang("zh")).toBe("zh");
    expect(pickMikaContentLang("en")).toBe("en");
  });
});

describe("getMikaOnboarding", () => {
  it("returns the localized title and the matching language tag", () => {
    expect(getMikaOnboarding("en")).toEqual({
      title: "Getting started with Mika",
      language: "en",
    });
    expect(getMikaOnboarding("zh")).toEqual({
      title: "和 Mika 开始",
      language: "zh",
    });
  });

  it("carries no agent-defining fields", () => {
    // Name, description, avatar, permissions and instructions are server
    // constants. A client that sent them could mint an agent claiming Mika's
    // identity, and a server-side prompt update would stop taking effect.
    const definition = getMikaOnboarding("en");
    expect(Object.keys(definition).sort()).toEqual(["language", "title"]);
  });

  it("gives every content language a non-empty title", () => {
    for (const lang of ["en", "zh", "ko", "ja"] as const) {
      const definition = getMikaOnboarding(lang);
      expect(definition.language).toBe(lang);
      expect(definition.title.length).toBeGreaterThan(0);
    }
  });
});
