import { describe, expect, it } from "vitest";
import { verify, load, type Claim, type MeasureContext } from "./tally";

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
 *
 * The 149 round asserted the ko rule on literal figures only and covered the
 * placeholder half with three hand-picked anchors, on the reasoning that a
 * placeholder-side rule would fire on Korean prose because a counter doubles as
 * a word-initial (`{{index}} 편집`, `{{when}} 시작됨`). The 150 round re-checked
 * that reasoning and it does not hold: a detector that requires the token after
 * the placeholder to be a member of the counter set cannot fire on those, because
 * 편집 and 시작됨 are not counters. Narrowing the placeholder to count-like names
 * is a second, redundant guard. The full placeholder side is therefore asserted
 * below — **170 keys / 179 occurrences tight, 0 spaced** — with the three anchors
 * kept as named examples.
 */


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
 * `scripts/probe-iter149-ja-ko-forms.py`. The 152 round turned them from
 * sentences into claims the guard re-derives — see `./tally.ts`.
 *
 * ja is a `converged` claim: the 149 round measured 66 full-width against 19
 * half-width and folded the 19 into the full-width form. Re-deriving it asserts
 * that the 19 are now full-width *and* that nothing else moved, which a
 * sentence could not.
 */
const PAREN_CLAIMS: Record<(typeof LOCALES)[number], Claim[]> = {
  ja: [
    {
      label: "parentheses (ja): 66 full-width vs 19 half-width, over 19 keys, no partition",
      when: "converged",
      primary: { pattern: /（[^（）]*）/g, expected: 66, unit: "by occurrence" },
      rivals: [{ pattern: /\([^()]*\)/g, expected: 19, unit: "by occurrence" }],
    },
  ],
  ko: [
    {
      label: "parentheses (ko): 129 half-width vs 0 full-width",
      primary: { pattern: /\([^()]*\)/g, expected: 129, unit: "by occurrence" },
      rivals: [{ pattern: /（[^（）]*）/g, expected: 0, unit: "by occurrence" }],
    },
  ],
};

/**
 * Korean counters. The literal rule is asserted on a **literal figure**; the
 * placeholder rule (below) needs its own detector because the shared `mask()`
 * erases `{{...}}` — the very token that rule keys on — so that half reads the
 * raw value.
 */
const KO_COUNTERS = "초|분|시간|일|주|개월|년|건|개|명|번|가지|회|달";

/**
 * A placeholder whose name is a count. A figure can only sit next to a counter
 * through one of these, which is what keeps the placeholder detector from firing
 * on prose: `{{index}} 편집` and `{{when}} 시작됨` are not counters, so the
 * counter-set membership test rejects them before this list is consulted.
 */
const KO_COUNT_LIKE =
  "count|total|shown|passed|failed|running|queued|deleted|days|hours|minutes|seconds|value|limit|remaining|used|size|index|online|owned";

/** The 149 round's literal-figure tally; the 150 round re-measured it unchanged. */
const KO_UNIT_CLAIM: Claim = {
  label: "ko figure spacing: 37 tight occurrences vs 0 spaced, on a literal figure",
  primary: { pattern: new RegExp(`\\d(?:${KO_COUNTERS})`, "g"), expected: 37, unit: "by occurrence" },
  rivals: [
    {
      pattern: new RegExp(`\\d\\s+(?:${KO_COUNTERS})`, "g"),
      expected: 0,
      unit: "by occurrence",
    },
  ],
};

/** The 150 round's full placeholder-side tally. Reads the raw value — see above. */
const KO_PLACEHOLDER_CLAIM: Claim = {
  label: "ko placeholder spacing: 179 tight occurrences vs 0 spaced, on a placeholder",
  primary: {
    pattern: new RegExp(`\\{\\{(?:${KO_COUNT_LIKE})\\}\\}(?:${KO_COUNTERS})`, "g"),
    expected: 179,
    unit: "by occurrence",
    unmasked: true,
  },
  rivals: [
    {
      pattern: new RegExp(`\\{\\{(?:${KO_COUNT_LIKE})\\}\\}\\s+(?:${KO_COUNTERS})`, "g"),
      expected: 0,
      unit: "by occurrence",
      unmasked: true,
    },
  ],
};

const claimCtx = (locale: string): MeasureContext => ({
  locale,
  unit: "by occurrence",
  bundles: { en, ja, ko },
  mask,
});

const problems = (locale: string, claims: Claim[]) =>
  claims.flatMap((claim) => verify(claim, claimCtx(locale)));

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

  it("re-derives the tally the parentheses convention was derived from", () => {
    for (const locale of LOCALES) {
      expect(problems(locale, PAREN_CLAIMS[locale]), `${locale} parentheses`).toEqual([]);
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

  it("re-derives the tally the convention was derived from", () => {
    expect(problems("ko", [KO_UNIT_CLAIM])).toEqual([]);
  });
});

/**
 * The placeholder half of the same rule, asserted in full from the 150 round on.
 * 149 covered it with three anchors because it expected a placeholder-side rule to
 * fire on Korean prose; that expectation did not survive re-measurement (see the
 * file note), and an anchor list is a weaker pin than the rule itself — a new
 * sentence with a spaced counter would slip past it.
 *
 * These read the **raw** value: the shared `mask()` replaces `{{...}}` with `…`,
 * which is exactly the token being matched.
 */
describe("ko attaches a counter to a placeholder too", () => {
  const SPACED = new RegExp(`\\{\\{(?:${KO_COUNT_LIKE})\\}\\}\\s+(?:${KO_COUNTERS})`);
  const TIGHT = new RegExp(`\\{\\{(?:${KO_COUNT_LIKE})\\}\\}(?:${KO_COUNTERS})`);

  it("never puts a space between a placeholder and its counter", () => {
    const offenders = Object.keys(ko)
      .filter((key) => SPACED.test(ko[key] ?? ""))
      .map((key) => `${key}: ${JSON.stringify(ko[key])}`);
    expect(offenders).toEqual([]);
  });

  it("still writes the tight form, so the rule above is not vacuous", () => {
    const occurrences = Object.keys(ko).reduce(
      (total, key) => total + (ko[key]?.match(new RegExp(TIGHT, "g"))?.length ?? 0),
      0,
    );
    expect(occurrences).toBeGreaterThan(100);
  });

  /**
   * The counter-set membership test is what makes the rule safe, so it is pinned
   * directly: the shapes 149 expected to be false positives must not match.
   */
  it("does not fire on a placeholder followed by a non-counter word", () => {
    const FALSE_POSITIVES = [
      "인자 {{index}} 편집",
      "인자 {{index}} 제거",
      "+{{count}} 대기 중",
      "{{online}}/{{total}} 온라인",
      "{{owned}}/{{total}} 보유",
      "{{page}} / {{totalPages}} 페이지",
    ];
    for (const value of FALSE_POSITIVES) {
      expect(
        TIGHT.test(value),
        `${JSON.stringify(value)} must not read as a figure+counter pair`,
      ).toBe(false);
      expect(SPACED.test(value), `${JSON.stringify(value)} must not read as a spaced pair`).toBe(
        false,
      );
    }
  });

  it("re-derives the tally the placeholder rule was derived from", () => {
    expect(problems("ko", [KO_PLACEHOLDER_CLAIM])).toEqual([]);
  });
});
