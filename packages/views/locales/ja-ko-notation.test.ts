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
 * The 152 round's addition: the two katakana axes the 151 round did not reach.
 *
 * 151 settled the long-vowel mark (`ブラウザ` / `ブラウザー`) and the vowel
 * (`デフォルト` / `ディフォルト`) by listing the words. Both neighbours are
 * measured here instead, because a word list is exactly what a *new* word walks
 * past:
 *
 *   - **sokuon `ッ`** — `セッション` / `セション`, `コミット` / `コミト`. A word
 *     written both ways is the same defect shape as the `フォルダ` split.
 *   - **yoon `ャュョ`** — `キャンセル` / `キヤンセル`. Unlike sokuon this axis has
 *     an absolute rule rather than a majority one: after an i-column kana
 *     (キ シ チ ニ ヒ ミ リ ギ ジ ビ ピ) a glide kana is always small in modern
 *     Japanese, so the large spelling is not a variant, it is wrong.
 *
 * The detector is **normalisation**, not a word list: every katakana run in the
 * bundle is folded once — ッ removed, or small kana enlarged — and the runs are
 * grouped by their folded form. A group with more than one member is one word
 * spelled two ways, and it is found without knowing in advance which words are
 * in the bundle. That is what makes it catch the word nobody thought to list.
 *
 * Measured over the whole ja bundle: 494 distinct katakana runs, 91 of them
 * carrying a ッ, and **zero** groups that fold together on either axis. The
 * large-glide rule is also zero — no `[i-column][ヤユヨ]` anywhere.
 *
 * The small-kana histogram (ッ 98, ィ 46, ェ 30, ョ 30, ュ 28, ャ 17, ォ 9, ァ 8)
 * was measured and is **not** pinned: it guards no rule, and pinning it would
 * turn every new loanword in a future translation round into a red that says
 * nothing. The two counts below are pinned instead, because they are what keeps
 * the folds non-vacuous — a bundle with no katakana would pass both.
 */
const KATAKANA_RUN = /[ァ-ヺー]{2,}/g;
const SMALL_KANA = "ァィゥェォッャュョヮ";
const LARGE_OF: Record<string, string> = {
  ァ: "ア", ィ: "イ", ゥ: "ウ", ェ: "エ", ォ: "オ",
  ッ: "ツ", ャ: "ヤ", ュ: "ユ", ョ: "ヨ", ヮ: "ワ",
};

/** Every distinct katakana run in a bundle, with the keys it came from. */
function katakanaRuns(bundle: Bundle): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [key, value] of Object.entries(bundle)) {
    for (const run of value.match(KATAKANA_RUN) ?? []) {
      found.set(run, [...(found.get(run) ?? []), key]);
    }
  }
  return found;
}

/** Runs that fold to the same form but are not the same run — one word, two spellings. */
function foldSplits(runs: Map<string, string[]>, fold: (run: string) => string) {
  const groups = new Map<string, string[]>();
  for (const run of runs.keys()) {
    const folded = fold(run);
    groups.set(folded, [...(groups.get(folded) ?? []), run]);
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([folded, members]) => `${folded}: ${members.sort().join(" / ")}`);
}

describe("ja notation: no katakana word is spelled two ways", () => {
  const runs = katakanaRuns(ja);

  it("folds no two runs together when the sokuon is removed", () => {
    // セッション / セション, コミット / コミト, カット / カト.
    expect(foldSplits(runs, (run) => run.replace(/ッ/g, ""))).toEqual([]);
  });

  it("folds no two runs together when the small kana are enlarged", () => {
    // キャンセル / キヤンセル, シェア / シエア, チェック / チエック, ウィンドウ / ウインドウ.
    expect(foldSplits(runs, (run) => [...run].map((ch) => LARGE_OF[ch] ?? ch).join(""))).toEqual(
      [],
    );
  });

  it("never puts a large glide kana after an i-column kana", () => {
    // The absolute half of the yoon axis: キヤ, シユ, チヨ and the like are not
    // variants, they are mis-sized. Only the glide kana — シアター and ジオメトリ
    // are ordinary i+vowel sequences and are not evidence of anything.
    const offenders = Object.entries(ja)
      .flatMap(([key, value]) =>
        [...value.matchAll(/[キシチニヒミリギジビピ][ヤユヨ]/g)].map(
          (match) => `${key}: ${JSON.stringify(value)} — ${match[0]}`,
        ),
      );
    expect(offenders).toEqual([]);
  });

  it("keeps enough katakana for the folds to mean something", () => {
    // "No two runs fold together" is green on a bundle with no katakana at all.
    // Both numbers are the 152 measurement; a round that translates a namespace
    // away should re-measure rather than let the folds go quiet.
    expect(runs.size).toBe(494);
    expect([...runs.keys()].filter((run) => run.includes("ッ")).length).toBe(91);
  });

  it("records what the small kana histogram was, without pinning it", () => {
    // Pinned only to the extent that every small kana the bundle uses is
    // actually in use — the histogram itself is in the note above. A count that
    // changes with every new loanword would be churn, not a guard. ゥ is absent
    // from the histogram entirely; the bundle writes ュ, never ゥ.
    const used = new Set(
      [...runs.keys()].flatMap((run) => [...run].filter((ch) => SMALL_KANA.includes(ch))),
    );
    expect([...used].sort().join("")).toBe("ァィェォッャュョ");
  });
});

/**
 * NOTATION_NOTE — round 152, the ko half of the katakana measurement.
 *
 * The ja folds above work because a katakana run is a *word*: it carries no
 * inflection, so two runs that normalise to the same form are the same word
 * spelled two ways. The question this round had to answer for ko is whether the
 * same detector transfers. It does not, and the negative result is recorded here
 * rather than re-walked:
 *
 *   - **Fold on the tense consonants** (ㄲ→ㄱ, ㄸ→ㄷ, ㅃ→ㅂ, ㅆ→ㅅ, ㅉ→ㅈ), the
 *     closest Korean analog of the sokuon: **0 splits**. That looks like a clean
 *     result and is not — it is green because it cannot see the one ko split the
 *     repo already knows about. `데스크톱` / `데스크탑` differ in the vowel, not
 *     the consonant, so this fold would have reported "no split" for a term the
 *     151 round pinned as a split. A detector that misses the known case is not
 *     evidence about the unknown ones.
 *   - **Fold on the final consonant** (받침 removed): **113 splits**, none of
 *     them spelling variance. Korean tokens carry inflection — `거부됨` /
 *     `거부된`, `계정을` / `계정은`, `가져올` / `가져옴` — so the fold merges
 *     grammatical forms and distinct words (`개발` / `개별`, `기반` / `기본`).
 *   - **Fold on the last vowel** (neutralised to ㅏ), the axis `데스크톱` /
 *     `데스크탑` actually varies on: **115 splits**, again all inflection
 *     (`그룹에` / `그룹이` / `그룹의`) or distinct words (`문자` / `문제`).
 *
 * So the katakana fold has no Hangul analog that is both noise-free and able to
 * see the splits that exist. The ko side's spelling-variant question is already
 * covered where it can be: `데스크톱` is pinned in `KO_PINNED` above, and the two
 * open ko splits (`리뷰` / `검토`, `라벨` / `레이블`) are ledger entries. This is
 * the same shape of result as the 150 round's external-standard note — a route
 * that was walked and is empty, recorded so it is not walked again.
 */
describe("ja notation: the ko side of the fold is recorded as having no analog", () => {
  const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const note = source.split("NOTATION_NOTE")[1] ?? "";

  it("names the folds that were tried", () => {
    expect(note).toContain("tense consonants");
    expect(note).toContain("final consonant");
    expect(note).toContain("last vowel");
  });

  it("records the counts each fold produced", () => {
    expect(note).toContain("113 splits");
    expect(note).toContain("115 splits");
  });

  it("keeps the ko split the consonant fold cannot see where it is guarded", () => {
    // The reason that fold is not usable: it is blind to the split the repo
    // already settled. If a round ever removes this pin, the note above stops
    // being true.
    expect(occurrences(ko, /데스크톱/g)).toBe(19);
    expect(occurrences(ko, /데스크탑/g)).toBe(0);
  });
});

/**
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
