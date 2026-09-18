import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guard for ja / ko **notation inside a native word** — the 151 round's fourth
 * item, and the first time this axis was measured.
 *
 * Rounds 142–150 settled a long list of *word choices* (サーバー vs `Server`,
 * プライベート vs 非公開, 件 vs 個) and one *spacing* question (ko figure and
 * counter). None of them asked the question underneath all of those: when the
 * bundle has already chosen the native word, is it spelled the same way every
 * time? A word can be settled and still be written two ways, and a scan for
 * Latin residue cannot see either spelling.
 *
 * The candidates are the ones a katakana word actually varies on:
 *
 *   - **The long-vowel mark.** `ブラウザ` / `ブラウザー`, `コンピュータ` /
 *     `コンピューター`, `サーバ` / `サーバー`. Japanese writes some loanwords
 *     with a trailing `ー` and some without, and different publishers disagree,
 *     so the bundle has to pick per word.
 *   - **The vowel itself.** `デフォルト` / `ディフォルト`.
 *
 * Measured over the whole ja bundle, the answer is: **each word is internally
 * consistent except two.** Twelve words hold at zero exceptions in one spelling
 * and are pinned below; `ブラウザ` and `フォルダ` are split and are **not**
 * pinned here — they went to the ledger in `unsettled-ledger.test.ts` and to a
 * convergence respectively, and the last suite in this file pins which is
 * which, so a later round cannot quietly move one across.
 *
 * The tallies are pinned, not just the zero-exception claim. A guard that only
 * asserts "no `ブラウザー`" is green on a bundle where `ブラウザ` was deleted
 * entirely; a guard that only asserts "some `ブラウザ`" is green on a bundle
 * that reintroduced the long form. Both numbers are the derivation, so both are
 * recorded.
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

const ja = load("ja");
const ko = load("ko");

const occurrences = (bundle: Bundle, pattern: RegExp) =>
  Object.values(bundle).reduce((total, value) => total + (value.match(pattern) ?? []).length, 0);

const keysMatching = (bundle: Bundle, pattern: RegExp) =>
  Object.entries(bundle)
    .filter(([, value]) => pattern.test(value))
    .map(([key]) => key);

type Pinned = {
  /** The spelling the bundle uses, as a human-readable label. */
  form: string;
  /** What the bundle must contain. */
  primary: RegExp;
  /**
   * The competing spelling, which must not appear at all. Omitted for the words
   * whose only variable is the long-vowel mark and whose short form is not a
   * prefix of anything a reader would write — there is nothing to exclude, and
   * inventing a pattern for them would assert nothing.
   */
  rival?: RegExp;
  /** The 151 tally, in occurrences — the derivation this pin came from. */
  occurrences: number;
};

/**
 * `サーバ(?!ー)` rather than a bare `サーバ`: the short form is a *prefix* of
 * the long one, so a naive pattern counts every `サーバー` as a `サーバ` too and
 * reports a split that is not there. The 150 round lost a measurement to the
 * same class of mistake (a "native" pattern that matched the Latin form it was
 * supposed to exclude), so every rival pattern below is written to exclude its
 * own primary.
 */
const JA_PINNED: Pinned[] = [
  { form: "サーバー", primary: /サーバー/g, rival: /サーバ(?!ー)/g, occurrences: 57 },
  { form: "ユーザー", primary: /ユーザー/g, rival: /ユーザ(?!ー)/g, occurrences: 24 },
  { form: "コンピュータ", primary: /コンピュータ(?!ー)/g, rival: /コンピューター/g, occurrences: 33 },
  { form: "ヘッダー", primary: /ヘッダー/g, rival: /ヘッダ(?!ー)/g, occurrences: 6 },
  { form: "フッター", primary: /フッター/g, rival: /フッタ(?!ー)/g, occurrences: 1 },
  { form: "オーナー", primary: /オーナー/g, rival: /オーナ(?!ー)/g, occurrences: 15 },
  { form: "マネージャー", primary: /マネージャー/g, rival: /マネージャ(?!ー)/g, occurrences: 1 },
  { form: "エディタ", primary: /エディタ(?!ー)/g, rival: /エディター/g, occurrences: 1 },
  { form: "パラメータ", primary: /パラメータ(?!ー)/g, rival: /パラメーター/g, occurrences: 1 },
  { form: "デフォルト", primary: /デフォルト/g, rival: /ディフォルト/g, occurrences: 16 },
  { form: "メンバー", primary: /メンバー/g, occurrences: 95 },
  { form: "ワークスペース", primary: /ワークスペース/g, occurrences: 247 },
  { form: "デスクトップ", primary: /デスクトップ/g, occurrences: 19 },
];

const KO_PINNED: Pinned[] = [
  { form: "데스크톱", primary: /데스크톱/g, rival: /데스크탑/g, occurrences: 19 },
];

describe("ja notation: each loanword keeps the one spelling the bundle chose", () => {
  for (const { form, primary, rival, occurrences: tally } of JA_PINNED) {
    if (rival) {
      it(`never writes a rival spelling of ${form}`, () => {
        const offenders = keysMatching(ja, rival).map(
          (key) => `${key}: ${JSON.stringify(ja[key])} — the bundle writes ${form}`,
        );
        expect(offenders).toEqual([]);
      });
    }

    it(`still writes ${form} as often as the derivation measured`, () => {
      // Pinning the tally is what makes the rule non-vacuous in the other
      // direction: converging the rival to zero by deleting the word would
      // otherwise read as success.
      expect(occurrences(ja, primary)).toBe(tally);
    });
  }
});

describe("ko notation: each loanword keeps the one spelling the bundle chose", () => {
  for (const { form, primary, rival, occurrences: tally } of KO_PINNED) {
    if (rival) {
      it(`never writes a rival spelling of ${form}`, () => {
        const offenders = keysMatching(ko, rival).map(
          (key) => `${key}: ${JSON.stringify(ko[key])} — the bundle writes ${form}`,
        );
        expect(offenders).toEqual([]);
      });
    }

    it(`still writes ${form} as often as the derivation measured`, () => {
      expect(occurrences(ko, primary)).toBe(tally);
    });
  }
});

/**
 * The two words the measurement did **not** settle, and what happened to each.
 *
 * This is the suite that stops a later round from reading the pins above as
 * "every katakana word is settled". It also records the distinction the round
 * drew, because the two splits look alike and are not:
 *
 *   - **`フォルダ` — converged.** 8 occurrences of `フォルダ` against 1 of
 *     `フォルダー`, and the lone straggler sits on a *different surface*
 *     (`skills.detail.add_file.errors.is_directory`) from all seven majority
 *     keys (every one of them under `projects.resources.*`). No same-kind pair
 *     takes both forms, so this is section 2's first rule — a clear majority
 *     with debt behind it — and the straggler was converged.
 *   - **`ブラウザ` — left open, in the ledger.** 12 against 2, and unlike
 *     `フォルダ` the minority is *inside the majority's own namespace*: every
 *     one of the twelve is `settings.shortcuts.*` or elsewhere, but
 *     `settings.shortcuts.reserved_error` writes `ブラウザ` while its two
 *     siblings `settings.shortcuts.actions.goBack.description` and
 *     `goForward.description` write `ブラウザー`. Same surface, same kind
 *     (a sentence in the shortcuts settings), two forms — so neither the
 *     majority rule nor a partition argument is available, and picking one
 *     would be a guess. It is a ledger entry instead.
 */
describe("ja notation: the two splits the round drew a line between", () => {
  it("converged フォルダ, so no フォルダー survives", () => {
    const offenders = keysMatching(ja, /フォルダー/).map(
      (key) => `${key}: ${JSON.stringify(ja[key])} — フォルダー was converged to フォルダ`,
    );
    expect(offenders).toEqual([]);
    // 9 = the 8 majority occurrences plus the one straggler, now converged.
    expect(occurrences(ja, /フォルダ(?!ー)/g)).toBe(9);
  });

  it("left ブラウザ open, with both spellings still in use", () => {
    // If a round converges this, the ledger entry has to go at the same time —
    // `unsettled-ledger.test.ts` fails on a converged entry, so the two guards
    // agree by construction. This test is the pointer, not the authority.
    expect(occurrences(ja, /ブラウザ(?!ー)/g)).toBe(12);
    expect(occurrences(ja, /ブラウザー/g)).toBe(2);
  });

  it("keeps the collision that blocks a clean partition for ブラウザ", () => {
    // The reason the majority rule does not apply, asserted directly: the same
    // namespace takes both forms.
    expect(ja["settings.shortcuts.reserved_error"]).toContain("ブラウザ");
    expect(ja["settings.shortcuts.actions.goBack.description"]).toContain("ブラウザー");
    expect(ja["settings.shortcuts.actions.goForward.description"]).toContain("ブラウザー");
  });

  it("keeps フォルダ and ブラウザ classified differently, so neither drifts", () => {
    // The whole point of this suite: the two splits must not both end up
    // pinned, and must not both end up open.
    const ledger = readFileSync(resolve(LOCALES_DIR, "unsettled-ledger.test.ts"), "utf8");
    expect(ledger).toContain("ブラウザ");
    expect(ledger).not.toContain("フォルダ");
  });
});
