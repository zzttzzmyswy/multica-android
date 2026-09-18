import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The shared mechanism for a number a guard states about a bundle.
 *
 * Every guard in this directory pins counts: how many keys take one form, how
 * many occurrences a rule was derived from, how lopsided a split is. Until the
 * 152 round those numbers were **prose**. Some were checked for shape (does the
 * sentence contain "N native vs M"?) and none were checked for value, so a
 * number could be wrong from the day it was written and nothing could tell.
 *
 * Two were. The `payload` tally in `ja-ko-unlisted-terms.test.ts` read "2 keys
 * Latin" for a family that has three keys — and had three on the day the tally
 * was written, so it was never true. The `label` entry in
 * `ja-ko-concepts.test.ts` read "26 라벨 vs 24 레이블" where the bundle holds 25
 * 레이블, and the ledger one file over has said 25 all along. Neither guard
 * could fail on either, because a free-text number is not a claim.
 *
 * The 151 round had already built the fix for this in one place: the ledger's
 * `facts`, where every number in a `why` sentence carries the scope and pattern
 * it was measured over and the guard re-derives it. This module is that
 * mechanism, lifted so the guards can state numbers the same way. The ledger
 * still describes *why a question is open*; the guards describe *what the
 * convention is*. Both now state the numbers as measurements.
 *
 * Two shapes of claim exist, and the difference is not cosmetic:
 *
 *   - **`current`** — the numbers describe the bundle as it is. `expected` is
 *     the value, and a rival's `expected` is normally 0.
 *   - **`converged`** — the numbers describe the bundle *before* a round folded
 *     the rivals into the primary (the 148/149 rounds converged a batch and
 *     recorded what they measured first). Those numbers cannot be re-measured
 *     directly, but they are not free text either: the convergence is exactly
 *     the claim that every rival occurrence became a primary occurrence, so the
 *     guard asserts `current(primary) === before(primary) + Σ before(rivals)`
 *     and `current(rival) === 0` for each.
 *
 *     What that proves is narrower than "the convergence happened", and the
 *     difference is worth stating because the assertion is easy to overread: it
 *     proves the *current counts* are the ones a total convergence would leave,
 *     which is what a partial convergence breaks. A rival deleted outright and
 *     a primary added elsewhere — the same total, no folding — satisfies it too,
 *     and no count can tell those apart. The claim is necessary, not sufficient;
 *     the falsification run covers the failure it does catch.
 *
 *     Because the assertion is arithmetic, a claim that is not a convergence
 *     cannot be allowed to look like one. Three shapes would compute a number
 *     that means nothing, and each is rejected rather than measured: a claim
 *     with no rival expected to fold (its `before` is just the primary, so it is
 *     a `current` claim wearing a convergence's name), and a rival read from a
 *     different locale or with a different unit than the primary (the sum would
 *     add a count of keys to a count of occurrences).
 */

export type Bundle = Record<string, string>;
export type Unit = "by key" | "by occurrence";

export const LOCALES_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(LOCALES_DIR, "../../..");

export function namespaces(locale: string): string[] {
  return readdirSync(resolve(LOCALES_DIR, locale))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
}

export function flatten(value: unknown, prefix = ""): Bundle {
  if (value === null || typeof value !== "object") return { [prefix]: String(value) };
  return Object.entries(value as Record<string, unknown>).reduce<Bundle>(
    (acc, [key, child]) => Object.assign(acc, flatten(child, prefix ? `${prefix}.${key}` : key)),
    {},
  );
}

/** `namespace.key.path` -> string, for every namespace in a views locale. */
export function load(locale: string): Bundle {
  return namespaces(locale).reduce<Bundle>((acc, ns) => {
    const raw = readFileSync(resolve(LOCALES_DIR, locale, `${ns}.json`), "utf8");
    for (const [key, value] of Object.entries(flatten(JSON.parse(raw)))) {
      acc[`${ns}.${key}`] = value;
    }
    return acc;
  }, {});
}

/** The mobile app ships a flat zh/en bundle outside this directory. */
export function loadMobile(locale: string): Bundle {
  return flatten(
    JSON.parse(
      readFileSync(resolve(REPO_ROOT, `apps/mobile/lib/i18n/locales/${locale}.json`), "utf8"),
    ),
  );
}

let cached: Record<string, Bundle> | undefined;

/**
 * The bundles the locale guards measure. Loaded once per test process: parsing
 * the same JSON in every guard file is the bulk of their runtime.
 */
export function viewsBundles(): Record<string, Bundle> {
  cached ??= Object.fromEntries(
    readdirSync(LOCALES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .map((locale) => [locale, load(locale)]),
  );
  return cached;
}

/**
 * A pattern used to *select* keys must not be global, and one used to *count
 * occurrences* must be. `RegExp.test` on a global pattern advances `lastIndex`,
 * so the same pattern tested against successive values alternates between
 * matching and not — a silent, value-dependent wrong answer rather than a
 * crash. The guards write both kinds of pattern next to each other, so the
 * normalisation lives here instead of in a comment on every entry.
 */
const keyPattern = (pattern: RegExp) =>
  pattern.global ? new RegExp(pattern.source, pattern.flags.replace("g", "")) : pattern;

const occurrencePattern = (pattern: RegExp) =>
  pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);

export const countMatching = (bundle: Bundle, pattern: RegExp, also?: RegExp) =>
  Object.values(bundle).filter(
    (value) =>
      keyPattern(pattern).test(value) && (also === undefined || keyPattern(also).test(value)),
  ).length;

export const countOccurrences = (bundle: Bundle, pattern: RegExp) =>
  Object.values(bundle).reduce(
    (total, value) => total + (value.match(occurrencePattern(pattern)) ?? []).length,
    0,
  );

/** One number, and everything needed to re-derive it. */
export type Measure = {
  /** Key prefix the count is taken over; the whole bundle when omitted. */
  scope?: string;
  /** What is counted. */
  pattern: RegExp;
  /** When present, only values matching this too are counted (an overlap). */
  also?: RegExp;
  /**
   * When present, only these exact keys are counted — for a claim about a named
   * set the sentence spells out, which has no shared key prefix.
   */
  keys?: string[];
  /**
   * When present, the key set is *derived*: every key of `locale` whose value
   * matches `pattern`. `masked` runs the guard's mask over that value first,
   * which is what a claim about "wherever the English names the term" needs —
   * the English names it in prose, not inside a `{{binding}}`.
   */
  keysFrom?: { locale: string; pattern: RegExp; masked?: boolean; exclude?: RegExp };
  /**
   * The number of keys this measure was taken over, when that number is part of
   * the claim. A `converged` claim asserts arithmetic between a count taken
   * today and a count taken in an earlier round, and that means something only
   * if both were taken over the same key set. `keysFrom` derives its key set
   * from the *current* bundle, so a key added to the source since the
   * convergence moves the primary count without anything folding — the same
   * shape the arithmetic reports for a partial convergence, and reported as one
   * unless the size is pinned.
   *
   * Only a scope that is a *rule about the claim's own subject* is worth
   * pinning — the keys whose English names the concept, say. The whole bundle
   * and a broad key prefix grow for reasons that have nothing to do with the
   * claim, so pinning their size would turn every unrelated string into a
   * failure. Read by a `converged` claim only: a `current` count describes the
   * bundle as it is, which is what its `expected` is for.
   */
  scopeSize?: number;
  /** Overrides the claim's unit for this one number. */
  unit?: Unit;
  /** Overrides the claim's locale. */
  locale?: string;
  /** Read the raw value: the shared mask would erase the token being matched. */
  unmasked?: boolean;
  expected: number;
};

/** A number with the sentence it came from, for the failure message. */
export type Fact = Measure & { label: string };

export type Claim = {
  /** How the derivation sentence names this, for the failure message. */
  label: string;
  when?: "current" | "converged";
  primary: Measure;
  /** The competing forms. */
  rivals?: Measure[];
};

export type MeasureContext = {
  /** The locale a measure without its own `locale` is read from. */
  locale: string;
  /** The unit a measure without its own `unit` is read with. */
  unit: Unit;
  bundles: Record<string, Bundle>;
  /** The guard's own mask. Identity for the guards that have none. */
  mask: (value: string | undefined) => string;
};

/**
 * The three fields that narrow a measure to a key set. They select *different*
 * sets — an exact list, a set derived from another bundle, a key prefix — so a
 * measure naming two of them has no single reading: the count would silently be
 * taken over whichever the branches below happen to test first. That is the
 * `g`-flag trap in another guise (a plausible number, no error), so it is
 * rejected rather than resolved by precedence.
 */
const NARROWINGS = ["keys", "keysFrom", "scope"] as const;

function scoped(measure: Measure, ctx: MeasureContext): Bundle {
  const named = NARROWINGS.filter((field) => measure[field] !== undefined);
  if (named.length > 1) {
    throw new Error(
      `a measure narrows to one key set, but this one names ${named.join(" and ")} — they ` +
        `select different keys, and the count would silently be taken over only one of them`,
    );
  }
  const target = ctx.bundles[measure.locale ?? ctx.locale];
  if (target === undefined) {
    throw new Error(`no bundle loaded for locale ${measure.locale ?? ctx.locale}`);
  }
  const read = (value: string | undefined) => (measure.unmasked ? (value ?? "") : ctx.mask(value));
  if (measure.keys) {
    return Object.fromEntries(
      measure.keys.map((key) => {
        if (target[key] === undefined) throw new Error(`${key} is not in the bundle`);
        return [key, read(target[key])];
      }),
    );
  }
  if (measure.keysFrom) {
    const source = ctx.bundles[measure.keysFrom.locale];
    if (source === undefined) throw new Error(`no bundle loaded for ${measure.keysFrom.locale}`);
    const from = measure.keysFrom;
    return Object.fromEntries(
      Object.entries(source)
        .filter(([key]) => from.exclude === undefined || !from.exclude.test(key))
        .filter(([, value]) =>
          keyPattern(from.pattern).test(from.masked ? ctx.mask(value) : value),
        )
        .map(([key]) => [key, read(target[key])]),
    );
  }
  if (measure.scope) {
    return Object.fromEntries(
      Object.entries(target)
        .filter(([key]) => key.startsWith(measure.scope as string))
        .map(([key, value]) => [key, read(value)]),
    );
  }
  return Object.fromEntries(Object.entries(target).map(([key, value]) => [key, read(value)]));
}

export function measure(measure: Measure, ctx: MeasureContext): number {
  const bundle = scoped(measure, ctx);
  return (measure.unit ?? ctx.unit) === "by key"
    ? countMatching(bundle, measure.pattern, measure.also)
    : countOccurrences(bundle, measure.pattern);
}

/** How many keys a measure is taken over, before `pattern` narrows the values. */
export function scopeSize(measure: Measure, ctx: MeasureContext): number {
  return Object.keys(scoped(measure, ctx)).length;
}

/**
 * A convergence whose key set has changed since it was measured. Returned
 * *instead of* the arithmetic rather than alongside it: when the scope moved,
 * the sum is a consequence of that and not independent evidence, so reporting it
 * too would put the misleading explanation back in the output.
 */
function changedScopes(claim: Claim, rivals: Measure[], ctx: MeasureContext): string[] {
  const messages = [claim.primary, ...rivals]
    .filter((measure) => measure.scopeSize !== undefined)
    .map((measure) => {
      const size = scopeSize(measure, ctx);
      if (size === measure.scopeSize) return null;
      return (
        `${claim.label}: the scope holds ${size} keys where the before-counts were measured ` +
        `over ${measure.scopeSize} — a key added to it since then moves the count without ` +
        `folding anything, so the pre-convergence tally cannot be re-derived from the current ` +
        `bundle`
      );
    })
    .filter((message): message is string => message !== null);
  return [...new Set(messages)];
}

/**
 * Reject a `converged` claim whose arithmetic could not mean anything, before
 * measuring it. These are authoring mistakes, not facts about the bundle, so
 * they throw the way `scoped` does for a key that is not in the bundle.
 */
function checkConvergence(claim: Claim, rivals: Measure[], ctx: MeasureContext): void {
  if (!rivals.some((rival) => rival.expected > 0)) {
    throw new Error(
      `${claim.label}: a converged claim has to fold at least one rival occurrence, but ` +
        `${rivals.length === 0 ? "it names no rivals" : "every rival is expected 0"} — its ` +
        `pre-convergence tally would just be the primary, so the convergence is not asserted`,
    );
  }
  const locale = claim.primary.locale ?? ctx.locale;
  const unit = claim.primary.unit ?? ctx.unit;
  rivals.forEach((rival) => {
    const rivalLocale = rival.locale ?? ctx.locale;
    if (rivalLocale !== locale) {
      throw new Error(
        `${claim.label}: the primary is read from ${locale} and a rival from ${rivalLocale} — ` +
          `a convergence folds one bundle's rivals into that bundle's primary`,
      );
    }
    const rivalUnit = rival.unit ?? ctx.unit;
    if (rivalUnit !== unit) {
      throw new Error(
        `${claim.label}: the primary is counted ${unit} and a rival ${rivalUnit} — the ` +
          `pre-convergence sum would add two different quantities`,
      );
    }
  });
}

/**
 * Re-derive a claim's numbers and return one message per number that does not
 * hold. An empty array means the claim is true.
 */
export function verify(claim: Claim, ctx: MeasureContext): string[] {
  const when = claim.when ?? "current";
  const rivals = claim.rivals ?? [];
  const problems: string[] = [];
  if (when === "converged") {
    checkConvergence(claim, rivals, ctx);
    const changed = changedScopes(claim, rivals, ctx);
    if (changed.length > 0) return changed;
  }
  const measuredPrimary = measure(claim.primary, ctx);
  const measuredRivals = rivals.map((rival) => measure(rival, ctx));

  if (when === "current") {
    if (measuredPrimary !== claim.primary.expected) {
      problems.push(
        `${claim.label}: states ${claim.primary.expected}, the bundle has ${measuredPrimary}`,
      );
    }
    rivals.forEach((rival, index) => {
      if (measuredRivals[index] !== rival.expected) {
        problems.push(
          `${claim.label}: states ${rival.expected} for the rival form, the bundle has ` +
            `${measuredRivals[index]}`,
        );
      }
    });
    return problems;
  }

  const before = claim.primary.expected + rivals.reduce((sum, rival) => sum + rival.expected, 0);
  if (measuredPrimary !== before) {
    problems.push(
      `${claim.label}: the pre-convergence tally is ${claim.primary.expected} + ` +
        `${rivals.map((rival) => rival.expected).join(" + ") || 0} = ${before}, but the bundle ` +
        `holds ${measuredPrimary} — either the convergence was partial or the tally was wrong`,
    );
  }
  rivals.forEach((rival, index) => {
    if (measuredRivals[index] !== 0) {
      problems.push(
        `${claim.label}: ${measuredRivals[index]} rival occurrence(s) survived the convergence, ` +
          `which the tally says folded all ${rival.expected} of them into the primary`,
      );
    }
  });
  return problems;
}
