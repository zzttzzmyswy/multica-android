import { describe, expect, it } from "vitest";

import {
  LANGUAGE_OPTIONS,
  languageOptionForSaved,
  serverLanguageFor,
  type LanguageOptionId,
} from "./settings-language";

describe("settings-language", () => {
  it("defines exactly the three user-facing options", () => {
    expect(LANGUAGE_OPTIONS.map((o) => o.id)).toEqual([
      "system",
      "zh",
      "en",
    ]);
  });

  it("keeps every option's label key under settings.* for i18n", () => {
    for (const option of LANGUAGE_OPTIONS) {
      expect(option.labelKey).toMatch(/^settings\./);
    }
  });

  it("maps zh -> zh-Hans, en -> en, system -> null", () => {
    expect(serverLanguageFor("zh")).toBe("zh-Hans");
    expect(serverLanguageFor("en")).toBe("en");
    expect(serverLanguageFor("system")).toBeNull();
  });

  it("maps unknown ids to null (never sends a bogus value)", () => {
    expect(serverLanguageFor("ko" as LanguageOptionId)).toBeNull();
    expect(serverLanguageFor("" as LanguageOptionId)).toBeNull();
  });

  it("serverside values stay inside the API's accepted set", () => {
    const accepted = new Set(["en", "zh-Hans", "ko", "ja"]);
    for (const option of LANGUAGE_OPTIONS) {
      if (option.serverLanguage !== null) {
        expect(accepted.has(option.serverLanguage)).toBe(true);
      }
    }
  });

  it("highlights the explicit override when one is saved", () => {
    expect(languageOptionForSaved("zh")).toBe("zh");
    expect(languageOptionForSaved("en")).toBe("en");
  });

  it("falls back to the system option when no override is saved", () => {
    expect(languageOptionForSaved(null)).toBe("system");
  });
});