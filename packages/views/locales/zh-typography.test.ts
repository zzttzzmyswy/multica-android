import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  load,
  loadMobile,
  countOccurrences,
  measure,
  verify,
  REPO_ROOT,
  type Bundle,
  type Claim,
  type Fact,
  type MeasureContext,
} from "./tally";

/**
 * Guard for section 3 of the Chinese voice guide (Punctuation), across **both**
 * zh bundles.
 *
 * The 151 round is the first to scan zh punctuation. Rounds 142–150 walked ja
 * and ko almost exclusively (145 touched the chat surface, 140 the zh quote
 * clause), and the rules they settled — ja full-width parentheses, ko
 * half-width, ko figure-to-counter spacing — are ja/ko rules that say nothing
 * about zh. Section 3 had been in the contract since before round 139 with
 * nothing asserting it, so the drift it forbids sat in the bundle unmeasured.
 * It was 15 keys deep.
 *
 * Section 3 states two rules that are settled and one that is not:
 *
 *   - **Full-width punctuation in Chinese: `，。：；！？`.** A half-width `,` or
 *     `;` inside a Chinese sentence is a violation. The one legitimate
 *     half-width comma is the comma *inside an enum example value* —
 *     `completed, failed` is a literal list of status values the user reads as
 *     code, not prose, and the English is identical. It is masked below.
 *   - **Quotes: straight double quotes `"..."`. Do not use `「」` or curly
 *     quotes.** Both were in the bundle: 11 `「」` pairs and 3 curly pairs, all
 *     of them quoting a UI label or a user-supplied name.
 *   - **Ellipsis: undecided.** The bullet contradicts itself and no round has
 *     been authorised to choose, so nothing here asserts it. It is the one
 *     entry in `unsettled-ledger.test.ts` that needs both bundles to state, and
 *     it is checked there.
 *
 * The parentheses rule is **derived, not quoted**: section 3's punctuation list
 * does not name brackets. The bundle answers it anyway — every half-width pair
 * wraps a Latin word, an acronym or a `{{binding}}`, and every full-width pair
 * wraps Chinese. That partition holds at zero crossover, so it is asserted the
 * way section 2's ja/ko derivations are (a clean partition *is* the rule), and
 * the two pairs that broke it were converged rather than the rule widened.
 *
 * The 152 round classified the three surfaces 151 had measured but not
 * classified — `！？`, `·`, `—`/`–` — and split them the same way. `！？`, the
 * middle dot and the en dash are pinned at zero exceptions below; the em dash is
 * **not**, because both forms are in use on the same kind of string, so it is a
 * ledger entry instead. The distinction is the one the brackets turned on: a
 * majority with no partition behind it is debt and gets converged, a majority
 * with a same-kind pair taking both forms is a decision and needs an owner.
 */

const viewsZh = load("zh-Hans");
const mobileZh = loadMobile("zh");

const viewsEn = load("en");
const mobileEn = loadMobile("en");

const BUNDLES: { name: string; bundle: Bundle; en: Bundle }[] = [
  { name: "views zh-Hans", bundle: viewsZh, en: viewsEn },
  { name: "mobile zh", bundle: mobileZh, en: mobileEn },
];

/**
 * A bracket inside inline code is a literal the user copies, not prose, so the
 * mask every bracket measurement runs under is the code-span stripper. It is the
 * same mask the bracket suite's own helpers apply inline.
 */
const CODE_SPAN = /`[^`]*`/g;

const bracketCtx: MeasureContext = {
  locale: "zh-Hans",
  unit: "by occurrence",
  bundles: { "zh-Hans": viewsZh, zh: mobileZh },
  mask: (value) => (value ?? "").replace(CODE_SPAN, " "),
};

/**
 * The convergence the 151 round performed on the brackets, as a claim. The
 * before-counts have been in the suite's prose since that round and nothing
 * could re-derive them — and the same round's commit message shows how easily
 * they go wrong, stating "5 half-width pairs against 74 full-width ones" where
 * 74 is a *post*-convergence count over views alone and 5 a pre-convergence one
 * over both bundles. See `./tally.ts` for what the claim does and does not
 * prove.
 */
const BRACKET_CLAIMS: Claim[] = [
  {
    label: "brackets (views zh-Hans): 70 full-width vs 4 half-width",
    when: "converged",
    primary: { pattern: /（[^（）]*）/g, expected: 70 },
    rivals: [{ pattern: /\([^()]*\)/g, expected: 4 }],
  },
  {
    label: "brackets (mobile zh): 36 full-width vs 1 half-width",
    when: "converged",
    primary: { pattern: /（[^（）]*）/g, expected: 36, locale: "zh" },
    rivals: [{ pattern: /\([^()]*\)/g, expected: 1, locale: "zh" }],
  },
];

/**
 * The evidence that a partition by content kind is false, measured rather than
 * asserted: full-width pairs whose content holds no Han character, which is what
 * the 151 round read as "25 in views, 11 in mobile" against the pre-convergence
 * bundle. The convergence moved both numbers, so the sentence has been wrong
 * since the round that wrote it.
 */
const NON_CHINESE_BRACKETS: Fact[] = [
  {
    label: "full-width pairs wrapping a non-Chinese token (views zh-Hans)",
    pattern: /（[^（）\p{Script=Han}]*）/gu,
    expected: 27,
  },
  {
    label: "full-width pairs wrapping a non-Chinese token (mobile zh)",
    pattern: /（[^（）\p{Script=Han}]*）/gu,
    expected: 12,
    locale: "zh",
  },
];

/**
 * Section 3's punctuation rules are rules for **Chinese**. A value with no Han
 * character in it is not Chinese copy and is not bound by them, however it is
 * punctuated.
 *
 * The first version of this suite masked one literal instead — `completed,
 * failed`, a status-list example value whose English source is identical. The
 * falsification run then added a third status to that same value and the guard
 * went red, which is the whole argument against a literal allow-list: it is
 * exactly as wide as the strings that existed the day it was written, and the
 * next one is a false red. The predicate below is the rule the allow-list was
 * approximating.
 */
const HAS_HAN = /\p{Script=Han}/u;

const offenders = (bundle: Bundle, pattern: RegExp, note: string) =>
  Object.entries(bundle)
    .filter(([, value]) => pattern.test(value))
    .map(([key, value]) => `${key}: ${note} — ${JSON.stringify(value)}`);

/** The same, restricted to strings that are actually Chinese copy. */
const chineseOffenders = (bundle: Bundle, pattern: RegExp, note: string) =>
  Object.entries(bundle)
    .filter(([, value]) => HAS_HAN.test(value))
    .filter(([, value]) => pattern.test(value))
    .map(([key, value]) => `${key}: ${note} — ${JSON.stringify(value)}`);

describe("zh punctuation: the settled half of section 3", () => {
  it("uses straight double quotes, never 「」", () => {
    for (const { name, bundle } of BUNDLES) {
      expect(offenders(bundle, /[「」]/, "「」 is banned by section 3; use straight quotes"), name).toEqual(
        [],
      );
    }
  });

  it("uses straight double quotes, never curly ones", () => {
    for (const { name, bundle } of BUNDLES) {
      expect(
        offenders(bundle, /[“”]/, "curly quotes are banned by section 3; use straight quotes"),
        name,
      ).toEqual([]);
    }
  });

  it("uses full-width ，inside a Chinese sentence", () => {
    // A half-width comma *between digits* is a thousands separator and is left
    // alone; a half-width comma anywhere else in these bundles is prose.
    for (const { name, bundle } of BUNDLES) {
      expect(
        chineseOffenders(bundle, /(?<!\d),(?!\d)/, "half-width , in Chinese copy; section 3 says ，"),
        name,
      ).toEqual([]);
    }
  });

  it("uses full-width ；inside a Chinese sentence", () => {
    for (const { name, bundle } of BUNDLES) {
      expect(
        chineseOffenders(bundle, /;/, "half-width ; in Chinese copy; section 3 says ；"),
        name,
      ).toEqual([]);
    }
  });

  it("uses full-width ？！", () => {
    // Listed in section 3 beside ，。：； and measured here for the first time.
    for (const { name, bundle } of BUNDLES) {
      expect(
        chineseOffenders(bundle, /[?!]/, "half-width ? or ! in Chinese copy; section 3 says ？！"),
        name,
      ).toEqual([]);
    }
  });
});

/**
 * The derived half. Section 3's punctuation list does not name brackets, so the
 * rule is read off the bundle instead — and the first reading was wrong, which
 * is why this suite asserts the second one.
 *
 * The tempting hypothesis is a partition by content kind: half-width brackets
 * wrap Latin, full-width wrap Chinese. It is false. Full-width brackets wrap a
 * non-Chinese token — a `{{binding}}`, an acronym, a product name — 27 times in
 * views and 12 in mobile (`（{{count}}）`, `（Lark）`, `（Go + Postgres）`,
 * `（xoxb-）`), so content kind separates nothing. The 151 round wrote that
 * sentence as "25 times in views and 11 in mobile", which is what the bundle
 * held *before* the same round converged the half-width stragglers — the
 * sentence was stale the moment the round finished, and nothing could say so.
 * Both numbers are measurements now: the pairs as a claim, the non-Chinese ones
 * as a fact.
 *
 * What the bundle actually does is use **full-width brackets everywhere** — 74
 * pairs in views, 37 in mobile — with 4 and 1 half-width stragglers against
 * them, two of which wrapped Chinese and three a placeholder or acronym. That is
 * the shape section 2 settles a term with: a clear majority and no partition
 * behind the minority, so the stragglers are debt. They were converged, and the
 * rule is pinned at zero exceptions.
 */
describe("zh punctuation: full-width brackets, the rule the bundle settles", () => {
  const PAIRS = /（([^（）]*)）|\(([^()]*)\)/g;

  /** Half-width pairs left after masking code spans, which are never prose. */
  function halfWidthPairs(bundle: Bundle): { key: string; content: string }[] {
    const found: { key: string; content: string }[] = [];
    for (const [key, value] of Object.entries(bundle)) {
      for (const match of value.replace(CODE_SPAN, " ").matchAll(PAIRS)) {
        if (match[2] !== undefined) found.push({ key, content: match[2] });
      }
    }
    return found;
  }

  function fullWidthPairs(bundle: Bundle): number {
    let count = 0;
    for (const value of Object.values(bundle)) {
      for (const match of value.replace(CODE_SPAN, " ").matchAll(PAIRS)) {
        if (match[1] !== undefined) count += 1;
      }
    }
    return count;
  }

  it("never uses half-width brackets in Chinese copy", () => {
    const found = BUNDLES.flatMap(({ name, bundle }) =>
      halfWidthPairs(bundle).map(
        ({ key, content }) =>
          `${name} ${key}: (${content}) — zh uses full-width brackets, （${content}）`,
      ),
    );
    expect(found).toEqual([]);
  });

  it("keeps both bracket forms measured, so the rule cannot pass vacuously", () => {
    // "No half-width brackets" is green on an empty bundle, and the rule only
    // means something while full-width brackets are actually in use. Pin the
    // counts the derivation came from.
    const full = BUNDLES.reduce((total, { bundle }) => total + fullWidthPairs(bundle), 0);
    expect(full).toBeGreaterThan(90);
    expect(fullWidthPairs(viewsZh)).toBe(74);
    expect(fullWidthPairs(mobileZh)).toBe(37);
  });

  it("re-derives the pre-convergence counts the rule was derived from", () => {
    // 70 + 4 and 36 + 1: the stragglers the 151 round folded into the majority,
    // stated in the suite's prose since then and re-derivable from here on. See
    // `./tally.ts` for what a `converged` claim does and does not prove.
    for (const claim of BRACKET_CLAIMS) {
      expect(verify(claim, bracketCtx), claim.label).toEqual([]);
    }
  });

  it("re-derives the evidence that content kind separates nothing", () => {
    for (const fact of NON_CHINESE_BRACKETS) {
      expect(measure(fact, bracketCtx), fact.label).toBe(fact.expected);
    }
  });
});

/**
 * The 152 round classified the three surfaces the 151 round measured but did not
 * classify. Two of them are settled at zero exceptions and are pinned here; the
 * third — the em dash — is not, and the last suite in this file says so and
 * points at the ledger.
 *
 * The `！？` rule is stated in **one direction only**, and the direction matters.
 * Every `！` and `？` in a zh bundle appears where the English has `!` or `?`,
 * which holds at zero exceptions (3 + 61 views keys, 2 + 69 mobile). The
 * converse does not hold: `mcp.agent.removeConfirmMessage` renders the English
 * question `Remove "{{name}}"?` as the Chinese statement `移除"{{name}}"后，…。`,
 * and the three `_one` plural keys exist only in English. Claiming the converse
 * would mean either converging a legitimate translation choice or carving out an
 * exception list, and an exception list is what the 151 round's bracket
 * falsification already showed to be the wrong shape. The 151 round's `Fleet`
 * correction is the same lesson from the other side: state the direction the
 * bundle actually answers.
 */
describe("zh punctuation: the full-width terminal mark mirrors the English source", () => {
  for (const [mark, latin] of [
    ["！", "!"],
    ["？", "?"],
  ] as const) {
    it(`writes ${mark} only where the English source has ${latin}`, () => {
      const offenders = BUNDLES.flatMap(({ name, bundle, en }) =>
        Object.entries(bundle)
          .filter(([, value]) => value.includes(mark))
          .filter(([key]) => !(en[key] ?? "").includes(latin))
          .map(
            ([key, value]) =>
              `${name} ${key}: ${JSON.stringify(value)} — en ${JSON.stringify(en[key] ?? null)}`,
          ),
      );
      expect(offenders).toEqual([]);
    });
  }

  it("never doubles or stacks a terminal mark", () => {
    const offenders = BUNDLES.flatMap(({ name, bundle }) =>
      Object.entries(bundle)
        .filter(([, value]) => /[！？]{2,}/.test(value))
        .map(([key, value]) => `${name} ${key}: ${JSON.stringify(value)}`),
    );
    expect(offenders).toEqual([]);
  });

  /**
   * Non-vacuity, the 151 bracket rule's second half: "no mark where the English
   * has none" is green on a bundle with no full-width marks at all, so the
   * positive evidence is pinned too.
   */
  it("keeps both marks in use, so the rule above cannot pass vacuously", () => {
    const counted = (bundle: Bundle, mark: string) =>
      Object.values(bundle).filter((value) => value.includes(mark)).length;
    expect(counted(viewsZh, "！")).toBe(3);
    expect(counted(viewsZh, "？")).toBe(61);
    expect(counted(mobileZh, "！")).toBe(2);
    expect(counted(mobileZh, "？")).toBe(69);
  });
});

/**
 * The middle dot is a **spaced** separator in both bundles: 73 occurrences in
 * views zh-Hans and 28 in mobile, and not one of them is run into a word — every
 * dot is followed by a space, and preceded by one unless it opens the value,
 * which is the two `runtimes.detail.*_chip_other` prefixes. The rule is stated
 * as "attached to no word on either side" rather than "space after" so that the
 * two boundaries the bundle actually has — a dot that opens the string, and a
 * dot that ends it — are not false reds. A tight `我的任务·全部` is the defect it
 * forbids.
 *
 * Provenance is *not* asserted, and the difference is recorded instead. Views
 * carries the English `·` one for one — all 68 keys that have one have it in the
 * English too. Mobile uses it as a general separator on 3 keys whose English
 * writes `by` or a space (`comment.foldBar`, `comment.resolvedBar`,
 * `agents.new.ai.sessionTitle`), which is a translation choice the bundle made
 * consistently, not a violation of anything.
 */
describe("zh punctuation: the middle dot is a spaced separator", () => {
  it("never runs · into the word on either side", () => {
    const offenders: string[] = [];
    for (const { name, bundle } of BUNDLES) {
      for (const [key, value] of Object.entries(bundle)) {
        for (const match of value.matchAll(/·/g)) {
          const before = match.index === 0 ? "" : value[match.index - 1];
          const after = value[match.index + 1] ?? "";
          if (after !== "" && after !== " ") {
            offenders.push(`${name} ${key}: ${JSON.stringify(value)} — no space after ·`);
          }
          if (before !== "" && before !== " ") {
            offenders.push(`${name} ${key}: ${JSON.stringify(value)} — no space before ·`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the dot in use, so the rule above cannot pass vacuously", () => {
    expect(countOccurrences(viewsZh, /·/g)).toBe(73);
    expect(countOccurrences(mobileZh, /·/g)).toBe(28);
  });

  it("records how each bundle came by its dots, without asserting it", () => {
    // The measurement the provenance note above states. Pinned because it is the
    // reason the rule stops at spacing: a future round that finds the English
    // provenance drifting should see the number it drifted from.
    const carriedFromEnglish = (bundle: Bundle, en: Bundle) =>
      Object.entries(bundle)
        .filter(([, value]) => value.includes("·"))
        .filter(([key]) => (en[key] ?? "").includes("·")).length;
    expect(carriedFromEnglish(viewsZh, viewsEn)).toBe(68);
    expect(carriedFromEnglish(mobileZh, mobileEn)).toBe(23);
  });
});

/**
 * The en dash is a range marker, and it is the English source's, not the
 * translation's: `{{min}}–{{max}}`, `{{from}}–{{to}}`, `10–30 秒`. Four keys
 * across the two bundles, zero exceptions. It is not a prose dash, which is why
 * it is not covered by the em-dash entry in the ledger.
 */
describe("zh punctuation: the en dash only appears where the English has one", () => {
  it("never introduces an en dash the English source does not have", () => {
    const offenders = BUNDLES.flatMap(({ name, bundle, en }) =>
      Object.entries(bundle)
        .filter(([, value]) => value.includes("–"))
        .filter(([key]) => !(en[key] ?? "").includes("–"))
        .map(([key, value]) => `${name} ${key}: ${JSON.stringify(value)}`),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the en dash in use, so the rule above cannot pass vacuously", () => {
    expect(countOccurrences(viewsZh, /–/g)).toBe(3);
    expect(countOccurrences(mobileZh, /–/g)).toBe(1);
  });
});

/**
 * The em dash is the one surface the round did **not** settle, and this suite is
 * the pointer to that decision rather than a second copy of it. Both forms are
 * live in both bundles — 95 views / 39 mobile keys write the doubled `——`, 3 and
 * 8 keep the English ` — ` — and the minority is not separated by surface or by
 * sentence shape: `issues.gantt.empty` and `issues.execution_log.retry_blocked`
 * are both an `issues.*` sentence that states a condition and then a hint.
 *
 * The distinction against the brackets one suite up is the whole point: the
 * brackets were converged because the majority had no partition behind it, and
 * this one has a same-kind pair taking both forms, which makes it a decision an
 * owner has to make. Converging it here would be the round picking a winner.
 */
describe("zh punctuation: what this guard does not claim", () => {
  it("does not settle the ellipsis, which is still in the ledger", () => {
    const ledger = readFileSync(resolve(REPO_ROOT, "packages/views/locales/unsettled-ledger.test.ts"), "utf8");
    expect(ledger).toContain("Ellipsis");
    expect(ledger).toContain("the ellipsis clause stays unresolved in both zh bundles");
  });

  it("does not settle the prose dash, which the 152 round measured and left open", () => {
    const ledger = readFileSync(resolve(REPO_ROOT, "packages/views/locales/unsettled-ledger.test.ts"), "utf8");
    expect(ledger).toContain('docTerm: "Dash (zh)"');
    // Both bundles still take both forms; if a round converges one, the ledger
    // entry fails first and this pointer has to move with it.
    expect(countOccurrences(viewsZh, /——/g)).toBeGreaterThan(0);
    expect(countOccurrences(viewsZh, / — /g)).toBe(3);
    expect(countOccurrences(mobileZh, /——/g)).toBeGreaterThan(0);
    expect(countOccurrences(mobileZh, / — /g)).toBe(8);
  });
});
