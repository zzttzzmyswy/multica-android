import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guard for the two ja / ko typography conventions that live outside the term
 * tables in conventions.mdx.
 *
 * 147 settled the parentheses: **ja uses full-width （）, ko uses half-width ()**.
 * The 148 round recorded it as settled without measuring it. The 149 round
 * measured it against the real bundles and found the ko side holding with zero
 * exceptions (129 half-width pairs, 0 full-width) while the ja side did not:
 * 66 full-width pairs against 19 half-width ones, over 19 keys, with no
 * partition behind them. The same key shape appeared both ways inside one
 * namespace, and the parenthetical content was native text 11 times and Latin 8
 * times, so neither "content kind" nor "surface" separated the two forms. Those
 * 19 were therefore stragglers of an already-settled rule, not a new decision:
 * they were converged and both sides are pinned here.
 *
 * The second convention is new. A figure and its counter are one token in
 * Korean: the bundle writes `45초`, `5분`, `30일`, `12건` and never `45 초`.
 * That is unanimous — 37 tight occurrences against 0 spaced ones — so it is
 * settled and pinned. Japanese is *not*: it writes `45 秒` 42 times and `45秒`
 * 14 times, with the same English source rendered both ways
 * (`autopilots.relative_date.one_day_ago` is `1 日前`, `projects.relative_date.
 * one_day_ago` is `1日前`), so it has no majority strong enough to call and no
 * partition. It is recorded in `unsettled-ledger.test.ts` instead.
 */

const LOCALES_DIR = dirname(fileURLToPath(import.meta.url));

type Bundle = Record<string, string>;

function namespaces(locale: string): string[] {
  return readdirSync(resolve(LOCALES_DIR, locale))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
}

function flatten(value: unknown, prefix = ""): Bundle {
  if (value === null || typeof value !== "object") return { [prefix]: String(value) };
  return Object.entries(value as Record<string, unknown>).reduce<Bundle>(
    (acc, [key, child]) => Object.assign(acc, flatten(child, prefix ? `${prefix}.${key}` : key)),
    {},
  );
}

function load(locale: string): Bundle {
  return namespaces(locale).reduce<Bundle>((acc, ns) => {
    const raw = readFileSync(resolve(LOCALES_DIR, locale, `${ns}.json`), "utf8");
    for (const [key, value] of Object.entries(flatten(JSON.parse(raw)))) {
      acc[`${ns}.${key}`] = value;
    }
    return acc;
  }, {});
}

const en = load("en");
const ja = load("ja");
const ko = load("ko");
const LOCALES = ["ja", "ko"] as const;

/**
 * Same masking idea as the term guards: a value that is typed, copied, or filled
 * in at render time is not prose and must not be read as one. Backticks cover
 * CLI examples (`agent --model …`), and the named literals cover the ones the
 * repo already treats as untranslatable.
 */
const MASKED_LITERALS = [
  /SKILL\.md/g,
  /Skills\.sh/g,
  /skill-name/g,
  /@squad/g,
  /Agent Builder/g,
  /agent\/…/g,
  /my-workspace/g,
  /`[^`]*`/g,
  /\{\{[^}]*\}\}/g,
];

const mask = (value: string | undefined) =>
  MASKED_LITERALS.reduce((acc, pattern) => acc.replace(pattern, "…"), value ?? "");

const HALF_PAIR = /\([^()]*\)/;
const FULL_PAIR = /（[^（）]*）/;

/**
 * The counts each rule was derived from, measured by
 * `scripts/probe-iter149-ja-ko-forms.py` on the pre-convergence bundle. Pinning
 * them means a later reader can tell a deliberate reversal from a fresh outlier,
 * and a future round that re-measures gets a number to compare against.
 */
const PAREN_TALLY = {
  ja: "66 full-width vs 19 half-width, over 19 keys, no partition",
  ko: "129 half-width vs 0 full-width",
} as const;

const KO_UNIT_TALLY = "37 tight occurrences vs 0 spaced, on a literal figure";

/**
 * Korean counters. The rule is asserted on a **literal figure** only, not on an
 * interpolation: Korean counter words double as word-initials (`{{index}} 편집`,
 * `{{when}} 시작됨` are both spelled `}} <counter-letter> …`), so a rule that
 * scanned placeholders would fire on prose that is already correct. The
 * placeholder form was measured too — 196 tight against those 2 spaced
 * collisions — and is deliberately left unasserted rather than pinned with an
 * exemption list that would have to grow with every new sentence.
 */
const KO_COUNTERS = "초|분|시간|일|주|개월|년|건|개|명|번|가지|회|달";

describe("ja / ko punctuation is settled by the bundle, not by the 147 note alone", () => {
  it("leaves no half-width () in the ja bundle", () => {
    const offenders = Object.keys(ja)
      .filter((key) => HALF_PAIR.test(mask(ja[key])))
      .map((key) => `${key}: ${JSON.stringify(ja[key])}`);
    expect(offenders).toEqual([]);
  });

  it("leaves no full-width （） in the ko bundle", () => {
    const offenders = Object.keys(ko)
      .filter((key) => FULL_PAIR.test(mask(ko[key])))
      .map((key) => `${key}: ${JSON.stringify(ko[key])}`);
    expect(offenders).toEqual([]);
  });

  /**
   * The sharpest single piece of evidence for the split: one English source
   * string, two locales, and the two forms side by side. If a later round
   * reverses the convention this is the first key it will touch, so the guard
   * names it rather than leaving the derivation to be re-discovered.
   */
  it("keeps the one English source that shows both forms side by side", () => {
    const key = "settings.dingtalk.byo_appkey_label";
    expect(en[key]).toBe("AppKey (client id)");
    expect(ja[key]).toBe("AppKey（client id）");
    expect(ko[key]).toBe("AppKey(client id)");
  });

  it("records the tally the parentheses convention was derived from", () => {
    for (const locale of LOCALES) {
      expect(PAREN_TALLY[locale], `${locale} needs a tally`).toMatch(/\d+ .*vs \d+/);
    }
  });
});

describe("ko attaches a counter to its figure", () => {
  const SPACED = new RegExp(`\\d\\s+(?:${KO_COUNTERS})`);

  it("never puts a space between a figure and its counter", () => {
    const offenders = Object.keys(ko)
      .filter((key) => SPACED.test(mask(ko[key])))
      .map((key) => `${key}: ${JSON.stringify(ko[key])}`);
    expect(offenders).toEqual([]);
  });

  /**
   * The rule has to be able to see the convention it pins, not just the absence
   * of the wrong form: a bundle with no figures at all would pass the test above.
   *
   * The anchors cover the half the rule above deliberately does not scan. It only
   * looks at a literal figure, so a placeholder counter could drift to the spaced
   * form without it noticing; these three keys pin that side too.
   */
  it("still writes the tight form, so the rule above is not vacuous", () => {
    const TIGHT = new RegExp(`\\d(?:${KO_COUNTERS})`);
    const hits = Object.keys(ko).filter((key) => TIGHT.test(mask(ko[key])));
    expect(hits.length).toBeGreaterThan(20);

    for (const key of [
      "billing.workspace.current.member_count_other",
      "agents.page.of_total",
      "agents.row.task_count_other",
    ]) {
      expect(ko[key], `${key} should attach the counter to its placeholder`).toMatch(
        /\}\}(개|명|건|일|회)/,
      );
    }
  });

  it("records the tally the convention was derived from", () => {
    expect(KO_UNIT_TALLY).toMatch(/\d+ tight occurrences vs \d+ spaced/);
  });
});
