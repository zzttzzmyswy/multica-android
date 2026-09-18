import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
 */

const LOCALES_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(LOCALES_DIR, "../../..");

type Bundle = Record<string, string>;

function flatten(value: unknown, prefix = ""): Bundle {
  if (value === null || typeof value !== "object") return { [prefix]: String(value) };
  return Object.entries(value as Record<string, unknown>).reduce<Bundle>(
    (acc, [key, child]) => Object.assign(acc, flatten(child, prefix ? `${prefix}.${key}` : key)),
    {},
  );
}

/** `namespace.key.path` -> string, for every namespace in the views bundle. */
function loadViewsZh(): Bundle {
  const dir = resolve(LOCALES_DIR, "zh-Hans");
  const namespaces = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
  return namespaces.reduce<Bundle>((acc, ns) => {
    const flat = flatten(JSON.parse(readFileSync(resolve(dir, `${ns}.json`), "utf8")));
    for (const [key, value] of Object.entries(flat)) acc[`${ns}.${key}`] = value;
    return acc;
  }, {});
}

const MOBILE_ZH = resolve(REPO_ROOT, "apps/mobile/lib/i18n/locales/zh.json");

const viewsZh = loadViewsZh();
const mobileZh = JSON.parse(readFileSync(MOBILE_ZH, "utf8")) as Bundle;

const BUNDLES: { name: string; bundle: Bundle }[] = [
  { name: "views zh-Hans", bundle: viewsZh },
  { name: "mobile zh", bundle: mobileZh },
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
 * `{{binding}}` 25 times in views and 11 in mobile (`（{{count}}）`, `（Lark）`,
 * `（Go + Postgres）`, `（xoxb-）`), so content kind separates nothing. What the
 * bundle actually does is use **full-width brackets everywhere** — 70 pairs in
 * views, 36 in mobile — with 4 and 1 half-width stragglers against them, two of
 * which wrapped Chinese and three a placeholder or acronym.
 *
 * That is the shape section 2 settles a term with: a clear majority and no
 * partition behind the minority, so the stragglers are debt. They were
 * converged, and the rule is pinned at zero exceptions.
 */
describe("zh punctuation: full-width brackets, the rule the bundle settles", () => {
  const PAIRS = /（([^（）]*)）|\(([^()]*)\)/g;
  const CODE_SPAN = /`[^`]*`/g;

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
});

/**
 * The ellipsis clause is deliberately absent above. Pin that it is still open,
 * so a later round cannot read this file's silence as "settled" — the ledger is
 * where the split is recorded, and this test is the pointer to it.
 */
describe("zh punctuation: what this guard does not claim", () => {
  it("does not settle the ellipsis, which is still in the ledger", () => {
    const ledger = readFileSync(resolve(LOCALES_DIR, "unsettled-ledger.test.ts"), "utf8");
    expect(ledger).toContain("Ellipsis");
    expect(ledger).toContain("the ellipsis clause stays unresolved in both zh bundles");
  });
});
