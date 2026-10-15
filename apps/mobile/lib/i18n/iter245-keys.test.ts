import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

/**
 * i18n spot-checks for iteration 245 — the agent-mode prompt field on the
 * new-issue modal became a real editor (upload toolbar + `@` support) instead
 * of a bare `TextInput`.
 *
 * No NEW keys were needed: the panel already resolved its placeholder from
 * `newIssue.agentPlaceholder`, and `DescriptionField` / `MarkdownToolbar` carry
 * their own (`issue.descriptionPlaceholder`, `a11y.attachImage`,
 * `a11y.attachFile`, `a11y.mention`). That is exactly why this file exists —
 * the iteration's visible strings are all REUSED keys, so nothing else in the
 * suite would notice if one were reworded, dropped, or overwritten with the
 * other locale's text. Same contract as the other `i18n/*-keys.test.ts` files:
 * every key resolves in BOTH locales and zh is a real translation, not the
 * raw-id fallback. (`locale-completeness.test.ts` covers "defined at all".)
 */
const LOCALES_DIR = path.resolve(__dirname, "locales");

function bundle(locale: string): Record<string, string> {
  return JSON.parse(
    readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

/** Keys the iteration-245 surface renders, with the zh wording that carries
 *  meaning the id cannot. */
const ZH_SPOT: Record<string, string> = {
  "newIssue.agentPlaceholder": "用自然语言描述任务，智能体会帮你创建…",
  "issue.descriptionPlaceholder": "描述…（输入 @ 以提及）",
  "a11y.attachImage": "附加图片",
  "a11y.attachFile": "附加文件",
  "a11y.mention": "提及某人",
};

/** en wording, so a value swapped for the other language's text fails here. */
const EN_SPOT: Record<string, string> = {
  "newIssue.agentPlaceholder": "Describe the task in plain language…",
  "a11y.attachImage": "Attach image",
  "a11y.attachFile": "Attach file",
};

describe("iteration 245 i18n", () => {
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

  it("resolves the reused prompt / toolbar keys in BOTH locales", () => {
    for (const key of Object.keys(ZH_SPOT)) {
      for (const locale of ["en", "zh"] as const) {
        mod.setLocale(locale);
        const value = mod.translate(key);
        expect(value, `${key} (${locale})`).not.toBe(key);
        expect(value.length, `${key} (${locale})`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the zh wording a real translation", () => {
    mod.setLocale("zh");
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      expect(mod.translate(key), key).toBe(zh);
    }
  });

  it("keeps the en wording English, not a copy of the zh value", () => {
    const zh = bundle("zh");
    const en = bundle("en");
    for (const [key, value] of Object.entries(EN_SPOT)) {
      expect(en[key], key).toBe(value);
      expect(en[key], key).not.toBe(zh[key]);
    }
    // Nothing on this surface should have collapsed to the zh text outright.
    for (const key of Object.keys(ZH_SPOT)) {
      expect(en[key], key).not.toBe(zh[key]);
    }
  });

  it("the upload buttons are reachable by a screen reader in both locales", () => {
    // The toolbar's image / file buttons are icon-only; their a11y label IS
    // their only text, so an empty or raw-id value leaves them unnameable.
    for (const locale of ["en", "zh"] as const) {
      mod.setLocale(locale);
      for (const key of ["a11y.attachImage", "a11y.attachFile", "a11y.mention"]) {
        const value = mod.translate(key);
        expect(value, `${key} (${locale})`).not.toContain("{{");
        expect(value.trim().length, `${key} (${locale})`).toBeGreaterThan(1);
      }
    }
  });
});
