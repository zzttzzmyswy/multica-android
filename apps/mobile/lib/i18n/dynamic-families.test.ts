import { readFileSync, globSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DYNAMIC_FAMILIES, wakeupStateKey, runStatusKey } from "./dynamic-families";

/**
 * The guard `locale-completeness.test.ts` cannot be.
 *
 * That harness scans the app for `t("literal.key")` and asserts each one
 * resolves. Families assembled from a variable — `t(`enum.status.${x}`)` —
 * are invisible to it by construction, which is how two of nine wakeup states
 * and `autopilots.runStatus.issue_created` shipped as raw ids on screen while
 * both bundles carried the correct copy (MYS-2433).
 *
 * This suite closes the hole from the other side: instead of reading the
 * source, it asks each family to enumerate every value it can produce, and
 * asserts each resulting id is real copy in BOTH bundles. Two properties make
 * that meaningful rather than vacuous:
 *
 *   - The values come from the same typed tables the app renders through
 *     (`lib/i18n/dynamic-families`), so a state added to a server union with
 *     no leaf is a `tsc` error, and a leaf renamed without renaming the table
 *     fails below.
 *   - The third test pins that every family in the app's source is registered
 *     here, so adding a NEW interpolation site cannot silently opt out.
 */

const APP_ROOT = path.resolve(__dirname, "../..");

function loadBundle(locale: "en" | "zh"): Record<string, string> {
  return JSON.parse(
    readFileSync(path.resolve(__dirname, `locales/${locale}.json`), "utf-8"),
  );
}

const EN = loadBundle("en");
const ZH = loadBundle("zh");

describe("runtime-built i18n families resolve in both bundles", () => {
  it("registers a non-trivial number of families and ids", () => {
    // Guards the tables themselves: an accidental `Object.values` on an empty
    // object would otherwise turn every assertion below into a vacuous pass.
    const ids = Object.values(DYNAMIC_FAMILIES).flat();
    expect(Object.keys(DYNAMIC_FAMILIES).length).toBeGreaterThanOrEqual(30);
    expect(ids.length).toBeGreaterThanOrEqual(150);
  });

  it("has no empty family", () => {
    const empty = Object.entries(DYNAMIC_FAMILIES)
      .filter(([, ids]) => ids.length === 0)
      .map(([family]) => family);
    expect(empty).toEqual([]);
  });

  it("defines every produced id in both bundles", () => {
    const missing: string[] = [];
    for (const [family, ids] of Object.entries(DYNAMIC_FAMILIES)) {
      for (const id of ids) {
        if (!(id in EN)) missing.push(`en: ${id}  (${family})`);
        if (!(id in ZH)) missing.push(`zh: ${id}  (${family})`);
      }
    }
    expect(missing.sort()).toEqual([]);
  });

  it("resolves every produced id to non-empty copy, never the id itself", () => {
    // A key can exist and still be blank, which the presence check above would
    // let through; and `translate()`'s fallback for a missing key is to echo
    // the id, so "output looks like a dotted id" is the symptom to assert on.
    const blank: string[] = [];
    for (const [family, ids] of Object.entries(DYNAMIC_FAMILIES)) {
      for (const id of ids) {
        for (const [locale, dict] of [
          ["en", EN],
          ["zh", ZH],
        ] as const) {
          const value = dict[id];
          if (typeof value !== "string" || value.length === 0) {
            blank.push(`${locale}: ${id} is blank  (${family})`);
          }
        }
      }
    }
    expect(blank.sort()).toEqual([]);
  });
});

describe("the two families whose vocabulary actually diverges", () => {
  it("maps every wakeup state to a leaf that exists", () => {
    // `wakeupState()` speaks web's snake_case; the dictionary camelCases. The
    // mapping is the fix for MYS-2433, so it is asserted directly rather than
    // only through the family inventory above.
    const states = DYNAMIC_FAMILIES["wakeups.ruleStates.<state>"];
    expect(states).toHaveLength(9);
    for (const id of states) expect(EN[id]).toBeTruthy();

    // The two that were missing, spelled both ways, so a regression that
    // reverts the mapping fails on the id rather than on a count.
    expect(wakeupStateKey("issue_closed")).toBe(
      "wakeups.ruleStates.issueClosed",
    );
    expect(wakeupStateKey("timed_out")).toBe("wakeups.ruleStates.timedOut");
    expect(EN["wakeups.ruleStates.issueClosed"]).toBe(
      "Issue ended; wakeups stopped",
    );
    expect(ZH["wakeups.ruleStates.timedOut"]).toBe("已超时");

    // The other seven are identity-mapped; a blanket rename would break these.
    expect(wakeupStateKey("waiting")).toBe("wakeups.ruleStates.waiting");
    expect(wakeupStateKey("expired")).toBe("wakeups.ruleStates.expired");
  });

  it("maps every run status to a leaf that exists", () => {
    expect(runStatusKey("issue_created")).toBe(
      "autopilots.runStatus.issueCreated",
    );
    expect(EN["autopilots.runStatus.issueCreated"]).toBe("Issue created");
    expect(ZH["autopilots.runStatus.issueCreated"]).toBe("已创建任务");
    expect(runStatusKey("skipped")).toBe("autopilots.runStatus.skipped");
  });
});

// ─── Coverage: no interpolation site may be left unregistered ──────────────

const APP_DIRS = ["app", "components", "data", "lib"];

function sourceFiles(): string[] {
  return globSync("{app,components,data,lib}/**/*.{ts,tsx}", {
    cwd: APP_ROOT,
    exclude: (name) =>
      name.endsWith(".test.ts") ||
      name.endsWith(".test.tsx") ||
      name.startsWith("lib/i18n/"),
  });
}

/**
 * Every `t(`…`)` / `translate(`…`)` template literal in the app, split into
 * the two shapes that need different checks.
 *
 * Local string constants are inlined first: `schedule-editor.tsx` writes
 * `${S}.time_label` against a module-level `const S`, and without the
 * substitution all 40 of its keys would file under the useless prefix `${S}`.
 * Inlining turns those into `static` keys — real ids the literal-key harness
 * also misses, because it only matches double quotes.
 */
function templateKeys(): {
  static: { key: string; file: string }[];
  dynamic: { prefix: string; file: string }[];
} {
  const staticKeys: { key: string; file: string }[] = [];
  const dynamic: { prefix: string; file: string }[] = [];

  for (const rel of sourceFiles()) {
    const src = readFileSync(path.join(APP_ROOT, rel), "utf-8");
    const consts = new Map<string, string>();
    for (const m of src.matchAll(
      /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*"([^"\\]*)"\s*;/g,
    ))
      consts.set(m[1], m[2]);

    const re = /(?<![A-Za-z0-9_$.])(?:t|translate)\(\s*`([^`]*)`/g;
    for (const m of src.matchAll(re)) {
      const inlined = m[1].replace(
        /\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g,
        (_full, name: string) => consts.get(name) ?? "\u0000",
      );
      // Anything left inside `${…}` is a runtime value (a member expression, a
      // ternary), so the key stops being knowable there.
      const variable = /\$\{[\s\S]*?\}|\u0000/.test(inlined);
      if (!variable) {
        if (m[1].includes(".")) staticKeys.push({ key: inlined, file: rel });
        continue;
      }
      const prefix = inlined
        .replace(/\$\{[\s\S]*?\}/g, "\u0000")
        .split("\u0000")[0];
      // Only dotted prefixes name a family; a bare `${x}` prefix does not.
      if (prefix.includes(".")) dynamic.push({ prefix, file: rel });
    }
  }
  return { static: staticKeys, dynamic };
}

describe("every runtime-built key family is registered", () => {
  it("resolves every template literal that inlines to a fixed key", () => {
    // `${S}.time_label` is not a family — after inlining `S` it is one id. The
    // literal-key harness skips it because the source uses a backtick, so
    // nothing checked these until now.
    const { static: staticKeys } = templateKeys();
    expect(staticKeys.length).toBeGreaterThan(50);

    const missing: string[] = [];
    for (const { key, file } of staticKeys) {
      if (!(key in EN)) missing.push(`en: ${key}  (${file})`);
      if (!(key in ZH)) missing.push(`zh: ${key}  (${file})`);
    }
    expect([...new Set(missing)].sort()).toEqual([]);
  });

  it("leaves no interpolation site without a family in DYNAMIC_FAMILIES", () => {
    // The registered families' static prefixes, longest first so a nested
    // family (`runtimes.detail.visibilityHint.`) is never satisfied by its
    // ancestor (`runtimes.`) by accident.
    const registered = Object.keys(DYNAMIC_FAMILIES).sort(
      (a, b) => b.length - a.length,
    );

    const uncovered = templateKeys()
      .dynamic.filter(({ prefix }) => !registered.some((f) => f.startsWith(prefix)))
      .map(({ prefix, file }) => `${prefix}  (${file})`);

    // Deduplicate: one site per file per prefix is enough to identify the gap.
    expect([...new Set(uncovered)].sort()).toEqual([]);
  });
});
