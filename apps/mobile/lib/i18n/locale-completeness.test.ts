import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

/**
 * Locale-completeness harness.
 *
 * Every literal `t("dotted.key")` / `translate("dotted.key")` in the app must
 * resolve to a real string in BOTH bundles. This is the safety net for the
 * failure mode where a locale JSON is rewritten (by a formatter, a merge, or
 * an agent editing the file) and silently drops keys: the app then renders
 * raw ids like `integrations.gh.disconnect` and nothing fails the build.
 *
 * Dynamic keys are skipped by construction — any argument that is not a
 * plain string literal in the source is not matched here. Namespaced
 * families that are only ever built at runtime (e.g. `enum.status.*`,
 * `filter.sort.*`) are also skipped via DYNAMIC_PREFIXES, so this stays a
 * "no literal key is missing" check rather than a false-positive generator.
 */
const DYNAMIC_PREFIXES = [
  "enum.",
  "filter.sort.",
  "filter.group.",
  "squads.status.",
  "status.",
  "runs.transcript.",
];

const APP_ROOT = path.resolve(__dirname, "../..");

function sourceFiles(): string[] {
  return globSync("{app,components,data,lib}/**/*.{ts,tsx}", {
    cwd: APP_ROOT,
    exclude: (name) => name.endsWith(".test.ts") || name.endsWith(".test.tsx"),
  });
}

/** Literal keys passed to `t(...)` or `translate(...)` as a plain string. */
function literalKeysIn(source: string): string[] {
  const keys: string[] = [];
  const re = /(?<![A-Za-z0-9_$.])(?:t|translate)\(\s*"([a-zA-Z][a-zA-Z0-9_.]*)"\s*[,)]/g;
  for (const match of source.matchAll(re)) keys.push(match[1]);
  return keys;
}

function loadBundle(locale: "en" | "zh"): Record<string, string> {
  return JSON.parse(
    readFileSync(
      path.resolve(__dirname, `locales/${locale}.json`),
      "utf-8",
    ),
  );
}

describe("locale completeness", () => {
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

  const used = (() => {
    const set = new Set<string>();
    for (const rel of sourceFiles()) {
      const src = readFileSync(path.join(APP_ROOT, rel), "utf-8");
      for (const key of literalKeysIn(src)) {
        if (DYNAMIC_PREFIXES.some((p) => key.startsWith(p))) continue;
        set.add(key);
      }
    }
    return set;
  })();

  it("finds a non-trivial number of literal keys in the app", () => {
    // Guards the regex itself: a refactor that changes how `t` is called
    // would otherwise turn this whole suite into a vacuous pass.
    expect(used.size).toBeGreaterThan(500);
  });

  it("defines every literal key in both bundles", () => {
    const en = loadBundle("en");
    const zh = loadBundle("zh");
    const missingEn: string[] = [];
    const missingZh: string[] = [];
    for (const key of used) {
      if (!(key in en)) missingEn.push(key);
      if (!(key in zh)) missingZh.push(key);
    }
    expect(missingEn.sort(), "keys missing from en.json").toEqual([]);
    expect(missingZh.sort(), "keys missing from zh.json").toEqual([]);
  });

  it("resolves every literal key through the translator", () => {
    // Catches a key that exists but is empty, which the bundle check alone
    // would let through.
    const blank: string[] = [];
    for (const key of used) {
      const value = mod.translate(key);
      if (typeof value !== "string" || value.length === 0 || value === key) {
        blank.push(key);
      }
    }
    expect(blank.sort()).toEqual([]);
  });

  it("keeps the two bundles key-for-key in sync", () => {
    const en = Object.keys(loadBundle("en")).sort();
    const zh = Object.keys(loadBundle("zh")).sort();
    const onlyEn = en.filter((k) => !zh.includes(k));
    const onlyZh = zh.filter((k) => !en.includes(k));
    expect(onlyEn, "present in en.json only").toEqual([]);
    expect(onlyZh, "present in zh.json only").toEqual([]);
  });
});
