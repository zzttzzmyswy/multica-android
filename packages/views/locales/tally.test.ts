import { describe, expect, it } from "vitest";
import {
  countMatching,
  countOccurrences,
  flatten,
  measure,
  scopeSize,
  verify,
  type Bundle,
  type Claim,
  type MeasureContext,
} from "./tally";

/**
 * Unit tests for the shared measuring mechanism, which until now was only
 * covered indirectly by the guards that use it.
 *
 * Indirect coverage is the wrong shape for this file. The guards state numbers
 * about *real bundles*, so a branch that mis-measures is indistinguishable from
 * a bundle that drifted — and two of the traps below are silent rather than
 * loud. `RegExp.test` on a global pattern advances `lastIndex`, so the same
 * pattern tested against successive values alternates between matching and not,
 * and the count comes out value-dependent and plausible. And a `converged`
 * claim whose numbers cannot mean anything (no rival to fold, a rival in
 * another locale, a rival in another unit) still computes a number, which is
 * exactly why it has to be rejected rather than measured.
 *
 * The bundles here are synthetic on purpose: a fixture whose numbers are chosen
 * to make each branch distinguishable says what the mechanism does, where a
 * snapshot of the real bundle would only say what it currently returns.
 */

const en: Bundle = {
  "a.one": "start the daemon",
  "a.two": "two daemons run here",
  "b.binding": "the {{daemon}} binding",
  "b.plain": "nothing to see",
  "b._one": "one daemon",
};

const ja: Bundle = {
  "a.one": "デーモンを起動",
  "a.two": "デーモンが2つ動作中、デーモンはここ",
  "b.binding": "{{daemon}} バインディング",
  "b.plain": "daemon はここ",
  "b._one": "デーモン1つ",
};

/** `デーモン` in 3 of the 5 keys, 4 times; the Latin form once, in `b.plain`. */
const ctx: MeasureContext = {
  locale: "ja",
  unit: "by key",
  bundles: { en, ja },
  mask: (value) => (value ?? "").replace(/\{\{[^}]*\}\}/g, "…"),
};

describe("flatten", () => {
  it("joins nested keys with a dot", () => {
    expect(flatten({ a: { b: "c", d: { e: "f" } } })).toEqual({ "a.b": "c", "a.d.e": "f" });
  });

  it("stringifies a leaf that is not a string", () => {
    expect(flatten({ a: 1, b: null })).toEqual({ a: "1", b: "null" });
  });
});

describe("the pattern flags", () => {
  const values: Bundle = { a: "x", b: "x", c: "x" };

  /**
   * The trap the normalisation exists for: `keyPattern` strips `g` because
   * `.test` on a global pattern resumes from `lastIndex`, so a guard that
   * happened to write `/x/g` would count 2 of these 3 values.
   */
  it("countMatching counts the same whether or not the pattern is global", () => {
    expect(countMatching(values, /x/)).toBe(3);
    expect(countMatching(values, /x/g)).toBe(3);
  });

  it("countMatching intersects with `also`", () => {
    expect(countMatching({ a: "xy", b: "x", c: "y" }, /x/, /y/)).toBe(1);
  });

  it("countMatching ignores a global flag on `also` too", () => {
    expect(countMatching({ a: "xy", b: "xz", c: "yz" }, /x/g, /y/g)).toBe(1);
  });

  /** The mirror image: counting occurrences needs `g`, so a plain pattern gets one. */
  it("countOccurrences counts every occurrence of a non-global pattern", () => {
    expect(countOccurrences({ a: "aaa" }, /a/)).toBe(3);
    expect(countOccurrences({ a: "aaa" }, /a/g)).toBe(3);
  });

  it("countOccurrences sums across values", () => {
    expect(countOccurrences({ a: "xx", b: "x", c: "none" }, /x/)).toBe(3);
  });
});

describe("measure: which keys", () => {
  it("reads the whole bundle when nothing narrows it", () => {
    expect(measure({ pattern: /デーモン/, expected: 0 }, ctx)).toBe(3);
  });

  it("narrows to a key prefix with `scope`", () => {
    expect(measure({ scope: "a.", pattern: /デーモン/, expected: 0 }, ctx)).toBe(2);
  });

  it("narrows to an exact key list with `keys`", () => {
    expect(measure({ keys: ["a.one"], pattern: /デーモン/, expected: 0 }, ctx)).toBe(1);
  });

  it("refuses a key list naming a key the bundle does not have", () => {
    expect(() => measure({ keys: ["a.missing"], pattern: /x/, expected: 0 }, ctx)).toThrow(
      "a.missing is not in the bundle",
    );
  });

  it("refuses a locale it was not given a bundle for", () => {
    expect(() => measure({ locale: "ko", pattern: /x/, expected: 0 }, ctx)).toThrow(
      "no bundle loaded for locale ko",
    );
  });

  /**
   * The derived key set, read through a pattern that matches every value so the
   * assertion is about the *keys* rather than about what they contain.
   */
  const keySetSize = (masked: boolean) =>
    measure(
      { keysFrom: { locale: "en", pattern: /(?<![A-Za-z])daemons?(?![A-Za-z])/i, masked }, pattern: /./, expected: 0 },
      ctx,
    );

  it("derives the key set from another locale with `keysFrom`", () => {
    // The English names the term in `a.one`, `a.two` and `b._one`; `b.binding`
    // only names it inside a `{{binding}}`, which is masked.
    expect(keySetSize(true)).toBe(3);
  });

  it("keeps the binding when `masked` is not set", () => {
    expect(keySetSize(false)).toBe(4);
  });

  it("drops keys the `exclude` pattern matches", () => {
    expect(
      measure(
        {
          keysFrom: {
            locale: "en",
            pattern: /(?<![A-Za-z])daemons?(?![A-Za-z])/i,
            masked: true,
            exclude: /_one$/,
          },
          pattern: /デーモン/,
          expected: 0,
        },
        ctx,
      ),
    ).toBe(2);
  });

  it("counts the derived keys' target values, not the English ones", () => {
    expect(
      measure(
        {
          keysFrom: { locale: "en", pattern: /(?<![A-Za-z])daemons?(?![A-Za-z])/i, masked: true },
          pattern: /デーモン/,
          expected: 0,
        },
        ctx,
      ),
    ).toBe(3);
  });

  it("reads the raw value when `unmasked` is set", () => {
    // The mask erases the very token a placeholder rule keys on.
    expect(measure({ keys: ["b.binding"], pattern: /\{\{daemon\}\}/, expected: 0 }, ctx)).toBe(0);
    expect(
      measure({ keys: ["b.binding"], pattern: /\{\{daemon\}\}/, unmasked: true, expected: 0 }, ctx),
    ).toBe(1);
  });

  it("lets one measure override the context's unit and locale", () => {
    expect(measure({ pattern: /デーモン/, unit: "by occurrence", expected: 0 }, ctx)).toBe(4);
    expect(measure({ pattern: /デーモン/, locale: "en", expected: 0 }, ctx)).toBe(0);
  });

  /**
   * The size of the key set, which a `converged` claim can pin. It is what the
   * count is taken over, so it is reported before `pattern` narrows the values —
   * `b.plain` is in the whole-bundle set even where the pattern misses it.
   */
  it("reports how many keys a measure was taken over", () => {
    expect(scopeSize({ pattern: /デーモン/, expected: 0 }, ctx)).toBe(5);
    expect(scopeSize({ scope: "a.", pattern: /デーモン/, expected: 0 }, ctx)).toBe(2);
    expect(
      scopeSize(
        {
          keysFrom: { locale: "en", pattern: /(?<![A-Za-z])daemons?(?![A-Za-z])/i, masked: true },
          pattern: /デーモン/,
          expected: 0,
        },
        ctx,
      ),
    ).toBe(3);
  });
});

/**
 * The fields around the narrowing, in combination. Each is covered on its own
 * above; what the guards actually write is pairs — a unit override under a
 * prefix, a locale override under a prefix, a mask that applies to one side of a
 * derived scope and not the other. The behaviour of each pair is asserted here
 * rather than left to whichever branch runs first.
 */
describe("measure: the narrowing fields in combination", () => {
  const derived = { locale: "en", pattern: /(?<![A-Za-z])daemons?(?![A-Za-z])/i };

  /**
   * A measure has one key set, and the three fields that name one name different
   * ones. Picking a winner by branch order would produce a plausible count for a
   * measure nobody can read, which is the failure mode the file exists to
   * prevent — so the pair is refused the way a vacuous convergence is.
   */
  describe("refuses two key sets at once", () => {
    it("refuses `keys` with `scope`", () => {
      expect(() =>
        measure({ keys: ["a.one"], scope: "a.", pattern: /デーモン/, expected: 0 }, ctx),
      ).toThrow("this one names keys and scope");
    });

    it("refuses `keys` with `keysFrom`", () => {
      expect(() =>
        measure({ keys: ["a.one"], keysFrom: derived, pattern: /デーモン/, expected: 0 }, ctx),
      ).toThrow("this one names keys and keysFrom");
    });

    it("refuses `keysFrom` with `scope`", () => {
      expect(() =>
        measure({ keysFrom: derived, scope: "a.", pattern: /デーモン/, expected: 0 }, ctx),
      ).toThrow("this one names keysFrom and scope");
    });

    it("says what the two fields would have selected", () => {
      expect(() =>
        measure({ keys: ["a.one"], scope: "a.", pattern: /デーモン/, expected: 0 }, ctx),
      ).toThrow(
        "a measure narrows to one key set, but this one names keys and scope — they select " +
          "different keys, and the count would silently be taken over only one of them",
      );
    });

    /** The narrowing is refused before the bundle is even looked up. */
    it("refuses the pair in `scopeSize` too", () => {
      expect(() =>
        scopeSize({ keys: ["a.one"], scope: "a.", pattern: /デーモン/, expected: 0 }, ctx),
      ).toThrow("a measure narrows to one key set");
    });
  });

  /**
   * `unit` and `locale` are overrides of the context, not narrowings, so they
   * compose with one — and the order matters: the scope is taken over the
   * overridden locale's bundle, and the unit is applied to the narrowed set
   * rather than to the whole bundle.
   */
  it("counts occurrences inside the narrowed scope, not across the bundle", () => {
    // `a.two` holds two of the three occurrences.
    expect(measure({ scope: "a.", pattern: /デーモン/, unit: "by occurrence", expected: 0 }, ctx)).toBe(3);
    expect(measure({ scope: "a.", pattern: /デーモン/, expected: 0 }, ctx)).toBe(2);
    expect(measure({ pattern: /デーモン/, unit: "by occurrence", expected: 0 }, ctx)).toBe(4);
  });

  it("narrows the overridden locale's bundle, not the context's", () => {
    expect(measure({ scope: "a.", pattern: /daemon/, locale: "en", expected: 0 }, ctx)).toBe(2);
    expect(measure({ scope: "a.", pattern: /daemon/, expected: 0 }, ctx)).toBe(0);
  });

  /**
   * `also` is an intersection on the same value `pattern` sees, so `unmasked`
   * moves both of them together — the mask is not re-applied to one and not the
   * other.
   */
  it("applies `also` to the same value `pattern` is tested against", () => {
    const both = { keys: ["b.binding"], pattern: /バインディング/, also: /\{\{daemon\}\}/ };
    expect(measure({ ...both, unmasked: true, expected: 0 }, ctx)).toBe(1);
    expect(measure({ ...both, expected: 0 }, ctx)).toBe(0);
  });

  /**
   * `keysFrom.masked` reads the *source*, `unmasked` reads the *target*: two
   * knobs on two bundles, and setting one must not move the other. The derived
   * set here is the four English keys that name the concept raw, `b.binding`
   * among them; the target is then read raw too, so that key's `{{daemon}}`
   * counts.
   */
  it("keeps the source mask and the target mask independent", () => {
    const derivedRaw = { keysFrom: { ...derived, masked: false } };
    expect(measure({ ...derivedRaw, pattern: /daemon/, unmasked: true, expected: 0 }, ctx)).toBe(1);
    expect(measure({ ...derivedRaw, pattern: /daemon/, expected: 0 }, ctx)).toBe(0);
    // Masking the source drops `b.binding` from the set, so the target read no
    // longer has anything to find.
    expect(
      measure(
        { keysFrom: { ...derived, masked: true }, pattern: /daemon/, unmasked: true, expected: 0 },
        ctx,
      ),
    ).toBe(0);
  });

  /**
   * A derived key the target does not have reads as empty rather than throwing,
   * unlike `keys`, where a missing key is the author's typo. The asymmetry is
   * not hypothetical: English carries `_one` plural keys that ja and ko do not,
   * which is why the concepts guard passes `exclude: PLURAL_ONE` — a derived set
   * that includes them counts them as untranslated. `parity.test.ts` is what
   * keeps the two key sets otherwise aligned.
   */
  it("reads a derived key the target lacks as empty, and still counts the scope", () => {
    const onlyEn: Bundle = { ...en, "c.only_en": "the daemon" };
    const withOnlyEn = { ...ctx, bundles: { en: onlyEn, ja } };
    const measure0 = {
      keysFrom: { ...derived, masked: true },
      pattern: /./,
      expected: 0,
    };
    expect(measure(measure0, withOnlyEn)).toBe(3);
    expect(scopeSize(measure0, withOnlyEn)).toBe(4);
  });
});

describe("verify: a current claim", () => {
  it("returns nothing when the numbers hold", () => {
    expect(verify({ label: "daemon", primary: { pattern: /デーモン/, expected: 3 } }, ctx)).toEqual(
      [],
    );
  });

  it("reports the stated and measured value for the primary", () => {
    expect(verify({ label: "daemon", primary: { pattern: /デーモン/, expected: 9 } }, ctx)).toEqual([
      "daemon: states 9, the bundle has 3",
    ]);
  });

  it("reports each rival separately", () => {
    expect(
      verify(
        {
          label: "daemon",
          primary: { pattern: /デーモン/, expected: 3 },
          rivals: [
            { pattern: /(?<![A-Za-z])daemon(?![A-Za-z])/, expected: 0 },
            { pattern: /ダエモン/, expected: 1 },
          ],
        },
        ctx,
      ),
    ).toEqual([
      "daemon: states 0 for the rival form, the bundle has 1",
      "daemon: states 1 for the rival form, the bundle has 0",
    ]);
  });
});

describe("verify: a converged claim", () => {
  /** 2 native + 1 rival before; a total convergence leaves 3 native and no rival. */
  const folded: Claim = {
    label: "daemon",
    when: "converged",
    primary: { pattern: /デーモン/, expected: 2 },
    rivals: [{ pattern: /(?<![A-Za-z])daemon(?![A-Za-z])/, expected: 1 }],
  };

  const withJa = (values: Bundle) => ({ ...ctx, bundles: { en, ja: values } });
  const FOLDED = { ...ja, "b.plain": "ここ" };

  it("accepts a convergence that folded every rival", () => {
    expect(verify(folded, withJa(FOLDED))).toEqual([]);
  });

  it("rejects a partial convergence", () => {
    // The rival is gone but the primary never picked it up.
    expect(verify(folded, withJa({ ...ja, "b.plain": "ここ", "b._one": "1つ" }))).toEqual([
      "daemon: the pre-convergence tally is 2 + 1 = 3, but the bundle holds 2 — either the " +
        "convergence was partial or the tally was wrong",
    ]);
  });

  /**
   * The compensating case: one occurrence was folded and another appeared, so
   * the primary count lands on the pre-convergence total while a rival is still
   * in the bundle. The sum alone would accept it; the rival check is what
   * catches it.
   */
  it("rejects a surviving rival even when the primary total adds up", () => {
    expect(verify(folded, ctx)).toEqual([
      "daemon: 1 rival occurrence(s) survived the convergence, which the tally says folded all " +
        "1 of them into the primary",
    ]);
  });

  it("rejects the second of two rivals surviving", () => {
    // Three native after a fold of one Latin and one `ダエモン` — except that
    // the `ダエモン` is still there and a third key took the native word.
    expect(
      verify(
        {
          ...folded,
          primary: { pattern: /デーモン/, expected: 1 },
          rivals: [
            { pattern: /(?<![A-Za-z])daemon(?![A-Za-z])/, expected: 1 },
            { pattern: /ダエモン/, expected: 1 },
          ],
        },
        withJa({ ...ja, "b.binding": "デーモン", "b.plain": "ここ", "b._one": "ダエモン" }),
      ),
    ).toEqual([
      "daemon: 1 rival occurrence(s) survived the convergence, which the tally says folded all " +
        "1 of them into the primary",
    ]);
  });

  /**
   * The limit of the assertion, pinned so a later round does not read it as
   * stronger than it is. Here the rival key was emptied and an unrelated key
   * gained a native word — no occurrence was folded, and the counts are the
   * same ones a fold leaves. No measurement over the current bundle separates
   * the two, so the claim is necessary rather than sufficient.
   */
  it("cannot distinguish a fold from a deletion plus an unrelated addition", () => {
    expect(verify(folded, withJa({ ...FOLDED, "b._one": "", "b.binding": "デーモン" }))).toEqual([]);
  });

  /**
   * A `keysFrom` scope is derived from the *current* source bundle, while a
   * convergence's before-counts are historical. A key added to the source since
   * the round grew the scope moves the primary count without anything folding —
   * a false red, reported by the arithmetic as a partial convergence. Pinning the
   * size is what separates the two, and it is the only thing that does.
   */
  const DERIVED = {
    keysFrom: { locale: "en", pattern: /(?<![A-Za-z])daemons?(?![A-Za-z])/i, masked: true },
  };
  /** The English names the concept in `a.one`, `a.two` and `b._one`. */
  const derived: Claim = {
    label: "daemon",
    when: "converged",
    primary: { ...DERIVED, pattern: /デーモン/, expected: 2, scopeSize: 3 },
    rivals: [
      { ...DERIVED, pattern: /(?<![A-Za-z])daemon(?![A-Za-z])/, expected: 1, scopeSize: 3 },
    ],
  };
  /** 3 native over the derived keys, the rival folded; `b.plain` is out of scope. */
  const DERIVED_JA = {
    "a.one": "デーモンを起動",
    "a.two": "デーモンが2つ",
    "b._one": "デーモン1つ",
    "b.plain": "ここ",
  };
  const GROWN_EN = { ...en, "c.new": "restart the daemon" };
  /** The new key, translated the way every other key is. Nothing regressed. */
  const GROWN_JA = { ...DERIVED_JA, "c.new": "デーモンを再起動" };
  const withGrown = { ...ctx, bundles: { en: GROWN_EN, ja: GROWN_JA } };

  it("accepts a convergence over a derived scope whose size still holds", () => {
    expect(verify(derived, withJa(DERIVED_JA))).toEqual([]);
  });

  it("reports a grown derived scope as the scope, not as a partial convergence", () => {
    expect(verify(derived, withGrown)).toEqual([
      "daemon: the scope holds 4 keys where the before-counts were measured over 3 — a key added " +
        "to it since then moves the count without folding anything, so the pre-convergence tally " +
        "cannot be re-derived from the current bundle",
    ]);
  });

  /**
   * The compensating case, and the reason the check returns instead of adding a
   * second problem: when the scope moved, the arithmetic is a consequence of
   * that and not independent evidence. Re-deriving the before-counts is the
   * right next action whether or not a fold was also undone, so the claim
   * reports the one thing it can actually tell.
   */
  it("reports the grown scope even when the fold is also broken", () => {
    expect(verify(derived, { ...withGrown, bundles: { en: GROWN_EN, ja: { ...GROWN_JA, "a.one": "ここ" } } })).toEqual([
      "daemon: the scope holds 4 keys where the before-counts were measured over 3 — a key added " +
        "to it since then moves the count without folding anything, so the pre-convergence tally " +
        "cannot be re-derived from the current bundle",
    ]);
  });

  /** One message, because the primary and the rival share the scope. */
  it("reports a changed scope once, not once per measure", () => {
    const problems = verify(derived, withGrown);
    expect(problems).toHaveLength(1);
  });

  it("leaves an unpinned derived scope to the arithmetic", () => {
    const unpinned: Claim = {
      ...derived,
      primary: { ...derived.primary, scopeSize: undefined },
      rivals: derived.rivals!.map((rival) => ({ ...rival, scopeSize: undefined })),
    };
    expect(verify(unpinned, withGrown)).toEqual([
      "daemon: the pre-convergence tally is 2 + 1 = 3, but the bundle holds 4 — either the " +
        "convergence was partial or the tally was wrong",
    ]);
  });

  /** Pinning the size must not swallow a partial convergence it did not cause. */
  it("still reports a partial convergence when the pinned scope is unchanged", () => {
    const pinned: Claim = {
      ...folded,
      primary: { ...folded.primary, scopeSize: 5 },
      rivals: folded.rivals!.map((rival) => ({ ...rival, scopeSize: 5 })),
    };
    expect(verify(pinned, withJa({ ...ja, "b.plain": "ここ", "b._one": "1つ" }))).toEqual([
      "daemon: the pre-convergence tally is 2 + 1 = 3, but the bundle holds 2 — either the " +
        "convergence was partial or the tally was wrong",
    ]);
  });

  /**
   * The pin is read by a `converged` claim only: a `current` count is meant to
   * describe the bundle as it is, so a scope that moved is what its `expected` is
   * for and the arithmetic already says so.
   */
  it("ignores the scope pin on a current claim", () => {
    expect(
      verify({ label: "daemon", primary: { pattern: /デーモン/, expected: 3, scopeSize: 99 } }, ctx),
    ).toEqual([]);
  });
});

/**
 * Shapes that compute a number which cannot mean anything. They are authoring
 * mistakes rather than facts about a bundle, so they throw where a mismatch
 * returns a problem — the same way `scoped` throws for a key that is missing.
 */
describe("verify: a converged claim that is not one", () => {
  const primary = { pattern: /デーモン/, expected: 2 };

  it("refuses a claim with no rivals to fold", () => {
    expect(() => verify({ label: "daemon", when: "converged", primary }, ctx)).toThrow(
      "daemon: a converged claim has to fold at least one rival occurrence, but it names no " +
        "rivals — its pre-convergence tally would just be the primary, so the convergence is " +
        "not asserted",
    );
  });

  it("refuses a claim whose rivals are all expected to fold nothing", () => {
    expect(() =>
      verify(
        {
          label: "daemon",
          when: "converged",
          primary,
          rivals: [{ pattern: /daemon/, expected: 0 }],
        },
        ctx,
      ),
    ).toThrow("every rival is expected 0");
  });

  it("accepts a rival expected 0 alongside one that folds", () => {
    expect(
      verify(
        {
          label: "daemon",
          when: "converged",
          primary,
          rivals: [
            { pattern: /(?<![A-Za-z])daemon(?![A-Za-z])/, expected: 1 },
            { pattern: /ダエモン/, expected: 0 },
          ],
        },
        { ...ctx, bundles: { en, ja: { ...ja, "b.plain": "ここ" } } },
      ),
    ).toEqual([]);
  });

  it("refuses a rival counted in a different unit from the primary", () => {
    expect(() =>
      verify(
        {
          label: "daemon",
          when: "converged",
          primary: { ...primary, unit: "by occurrence" },
          rivals: [{ pattern: /daemon/, expected: 1 }],
        },
        ctx,
      ),
    ).toThrow("the primary is counted by occurrence and a rival by key");
  });

  it("refuses a rival read from a different locale from the primary", () => {
    expect(() =>
      verify(
        {
          label: "daemon",
          when: "converged",
          primary,
          rivals: [{ pattern: /daemon/, locale: "en", expected: 1 }],
        },
        ctx,
      ),
    ).toThrow("the primary is read from ja and a rival from en");
  });
});
