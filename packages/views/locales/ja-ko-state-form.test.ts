import { describe, expect, it } from "vitest";
import { load, type Bundle } from "./tally";

/**
 * The state / resultative form in ja and ko — settled by the bundle, pinned here.
 *
 * This convention was not in any term table and no earlier round had looked for
 * it. The 150 round reached it from the third-round scan angle "ja suffix
 * composition": the scan asked whether `〜済み` / `〜なし` / `〜された` stay uniform
 * on the same kind of key, and the answer for `〜済み` was not just uniform but
 * load-bearing.
 *
 * What the bundles do, measured by `scripts/probe-iter150-state-form.py`:
 *
 * - **ja: a value that is nothing but a state label ends in `〜済み`** — 51 keys
 *   (`アーカイブ済み`, `解決済み`, `キャンセル済み`, …), and **0** values that are
 *   nothing but a state label end in `〜された`. The form is not used the other
 *   way round either: `済み` is never followed by `可能性` and never takes a
 *   passive auxiliary (`ます` / `ました` / `ません`), 0 hits on both.
 * - **ko: the same rule with `〜됨`** — 62 bare state labels (`보관됨`, `해결됨`,
 *   `저장됨`, …) against **0** bare labels ending in `〜된`. And `됨` never takes a
 *   sentence-final ending (`습니다` / `했다` / `한다` / `해요` / `입니다`) or a
 *   `하` / `되` continuation (`하여` / `해서` / `하고` / `하며` / `하지`), 0 hits on both.
 *
 * So there are two claims here, and only two — both measured at zero exceptions:
 *
 * 1. **A value that is nothing but a state label is terminal in the state form**:
 *    ja `〜済み` (51 keys, 0 bare labels in `〜された`) and ko `〜됨` (62 keys, 0
 *    bare labels in `〜된`).
 * 2. **Neither state form is ever a passive predicate**: `済み`+`可能性` and
 *    `済み`+`ます`/`ました`/`ません` are 0; `됨`+`습니다`/`했다`/`한다`/`해요`/`입니다`
 *    and `됨`+`하여`/`해서`/`하고`/`하며`/`하지` are 0.
 *
 * Note what is deliberately **not** claimed: that everything inside a sentence
 * takes the other form. It does not. ja uses `〜済み` as a pre-nominal modifier
 * (`削除済みエージェント`) *and* `〜された` as one (`保存されたビュー`), so the
 * modifier position takes both and is not a partition. Only the terminal-label
 * position is clean, and only that is asserted. The narrower claim is the honest
 * one; a rule that over-claims here would fire on correct copy, which is the
 * failure mode 149 hit with its `every -> some` false red.
 *
 * The near-miss worth naming: `runtimes.machine.not_found_hint` renders
 * "removed" as `削除済み` while four sibling keys render "deleted" as `削除された`.
 * Read as a counter that is a 4-vs-1 straggler, and a later round would converge
 * it — wrongly. The two are different English constructions: one is a participle
 * in a list of states ("It may be offline, removed, or no longer available to
 * you"), the other a passive clause ("It may have been deleted"). Claim 2 is what
 * separates them, and the pair is pinned below rather than left to be "fixed".
 * This is the same failure mode the ledger exists to prevent, one step earlier: a
 * false straggler rather than a false disagreement.
 */


const en = load("en");
const ja = load("ja");
const ko = load("ko");

/**
 * Same masking idea as the other ja/ko guards: a value that is typed, copied or
 * filled in at render time is not prose. Without it `{{count}} 件` and
 * `` `openclaw agent --local …` `` would be read as sentence text.
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
];

const mask = (value: string | undefined) =>
  MASKED_LITERALS.reduce((acc, pattern) => acc.replace(pattern, "…"), value ?? "");

/** A value that is nothing but a state label — no sentence around it. */
const BARE_JA_STATE = /^[^ ]{1,12}済み$/;
const BARE_KO_STATE = /^[^ ]{1,12}됨$/;
const BARE_JA_PASSIVE = /^[^ ]{1,12}された$/;
const BARE_KO_PASSIVE = /^[^ ]{1,12}된$/;

/**
 * The counts the rule was derived from, measured by
 * `scripts/probe-iter150-state-form.py`. Pinning the numbers means a later reader
 * can tell a deliberate reversal from a fresh outlier, and a round that
 * re-measures gets something to compare against.
 */
const STATE_FORM_TALLY = {
  ja: "51 bare state labels in 済み vs 0 in された",
  ko: "62 bare state labels in 됨 vs 0 in 된",
} as const;

const bareCount = (bundle: Bundle, pattern: RegExp) =>
  Object.values(bundle).filter((value) => pattern.test(mask(value).trim())).length;

describe("a ja state label ends in 済み, never in された", () => {
  it("has no bare state label in the passive form", () => {
    const offenders = Object.keys(ja)
      .filter((key) => BARE_JA_PASSIVE.test(mask(ja[key]).trim()))
      .map((key) => `${key}: ${JSON.stringify(ja[key])}`);
    expect(
      offenders,
      "a value that is nothing but a state label takes 済み; された belongs inside a sentence",
    ).toEqual([]);
  });

  it("still writes the 済み form, so the rule above is not vacuous", () => {
    expect(bareCount(ja, BARE_JA_STATE)).toBeGreaterThan(30);

    for (const key of [
      "agents.scope.archived",
      "issues.comment.resolve.thread_resolved_badge",
      "issues.status.cancelled",
    ]) {
      expect(ja[key], `${key} should be a bare 済み state label`).toMatch(BARE_JA_STATE);
    }
  });

  it("never uses 済み as a passive predicate", () => {
    const MODAL = /済み[^、。]{0,4}可能性/;
    const AUX = /済み\s*(ました|ません|ます)/;
    const offenders = Object.keys(ja)
      .filter((key) => MODAL.test(mask(ja[key])) || AUX.test(mask(ja[key])))
      .map((key) => `${key}: ${JSON.stringify(ja[key])}`);
    expect(
      offenders,
      "済み marks a state; a passive clause takes された. (A copular 済みです is fine and " +
        "is used, and a 済み modifier is fine — this asserts the passive forms only.)",
    ).toEqual([]);
  });

  /**
   * The claim above is deliberately narrow, so the boundary is pinned too: a
   * `〜された` *modifier* is legitimate ja (`保存されたビュー`) and must not be
   * caught by the bare-label rule. Without this the guard could be tightened into
   * a false red by a later round that reads claim 1 as "never use された".
   */
  it("allows された in a modifier position, which is not what claim 1 forbids", () => {
    const legit = ["保存されたビューはまだありません", "削除されたエージェント"];
    for (const value of legit) {
      expect(BARE_JA_PASSIVE.test(value.trim())).toBe(false);
    }
  });

  it("records the tally the rule was derived from", () => {
    expect(STATE_FORM_TALLY.ja).toMatch(/\d+ bare state labels in 済み vs 0 in された/);
  });
});

describe("a ko state label ends in 됨, never in 된", () => {
  it("has no bare state label in the modifier/passive form", () => {
    const offenders = Object.keys(ko)
      .filter((key) => BARE_KO_PASSIVE.test(mask(ko[key]).trim()))
      .map((key) => `${key}: ${JSON.stringify(ko[key])}`);
    expect(
      offenders,
      "a value that is nothing but a state label takes 됨; 된/되었 belongs inside a sentence",
    ).toEqual([]);
  });

  it("still writes the 됨 form, so the rule above is not vacuous", () => {
    expect(bareCount(ko, BARE_KO_STATE)).toBeGreaterThan(30);

    for (const key of [
      "agents.scope.archived",
      "issues.comment.resolve.thread_resolved_badge",
      "settings.auto_save.saved",
    ]) {
      expect(ko[key], `${key} should be a bare 됨 state label`).toMatch(BARE_KO_STATE);
    }
  });

  it("never uses 됨 as a sentence predicate", () => {
    const FINAL = /됨\s*(습니다|했다|한다|해요|입니다|하였다)/;
    const CONTINUATION = /됨\s*(하여|해서|하고|하며|하지)/;
    const offenders = Object.keys(ko)
      .filter((key) => FINAL.test(mask(ko[key])) || CONTINUATION.test(mask(ko[key])))
      .map((key) => `${key}: ${JSON.stringify(ko[key])}`);
    expect(
      offenders,
      "됨 ends a label; a predicate or modifier inside a sentence takes 된/되었",
    ).toEqual([]);
  });

  it("records the tally the rule was derived from", () => {
    expect(STATE_FORM_TALLY.ko).toMatch(/\d+ bare state labels in 됨 vs 0 in 된/);
  });
});

/**
 * The false straggler. Without this block a later round scanning "削除済み vs
 * 削除された" sees 3 against 4, calls the 3 the stragglers, and converges them —
 * destroying a distinction the bundle makes on purpose. The two English sources
 * are pinned alongside the renderings so the reason travels with the guard.
 */
describe("the runtimes not_found_hint pair keeps its two forms", () => {
  const STATE_KEY = "runtimes.machine.not_found_hint";
  const PASSIVE_KEY = "runtimes.detail_page.not_found_hint";

  it("keeps the English sources that differ in construction", () => {
    expect(en[STATE_KEY]).toBe("It may be offline, removed, or no longer available to you.");
    expect(en[PASSIVE_KEY]).toBe("It may have been deleted or you may not have access.");
  });

  it("keeps the state form for the adjective list and the passive for the clause", () => {
    expect(
      ja[STATE_KEY],
      "a participle inside a list of states is a state, so it takes 済み",
    ).toContain("削除済み");
    expect(
      ja[PASSIVE_KEY],
      "a passive clause takes された, not 済み",
    ).toContain("削除された");
  });

  it("is not a straggler: the 済み form is the family norm, not an outlier", () => {
    // The whole point of the pair above. If a later round converges either side,
    // the 済み family count drops and this goes red — which is the signal to
    // re-read this file rather than to re-converge.
    const shimi = Object.values(ja).filter((value) => value.includes("済み")).length;
    expect(shimi, "the 済み family should be large; if this drops, check what converged it")
      .toBeGreaterThan(100);
  });
});
