import { describe, expect, it } from "vitest";
import { verify, load, type Claim, type MeasureContext } from "./tally";

/**
 * Guard for the terms ja and ko render with one word that conventions.mdx does
 * *not* list as a concept.
 *
 * `ja-ko-concepts.test.ts` guards section 2 of conventions.mdx, and its name
 * and header say so. The terms here are outside that section: `instance`,
 * `desktop`, `provider`, `batch`, `heartbeat` and `tier` are ordinary nouns the
 * section never names, and `Pull request` is a Latin term whose *casing* is the
 * convention. Folding them into `CONCEPTS` would make that suite's
 * self-description wrong, so they are guarded here instead — by the same rule,
 * with the derivation recorded per entry so the next round can tell a genuine
 * reversal from a fresh outlier.
 *
 * Two kinds of entry live here:
 *
 * - `MAJORITY_TERMS` — the bundle already renders the term with one native word
 *   nearly everywhere. The outliers are debt, not a choice, so they were
 *   converged and the majority is now pinned. The claim records what the 148
 *   round measured before the convergence, and the guard re-derives it from the
 *   converged bundle (see `./tally.ts`).
 * - `UNPRECEDENTED_TERMS` — neither bundle had any precedent and zh had already
 *   translated the term. The native word is the standard rendering, not a
 *   derivation, and the reason says so.
 *
 * `LATIN_CASING` is a third shape: a term both locales keep in Latin, where the
 * convention is which letters are capitalised.
 */


const en = load("en");
const ja = load("ja");
const ko = load("ko");
const TARGETS = { ja, ko } as const;
type Locale = keyof typeof TARGETS;
const LOCALES = ["ja", "ko"] as const;

/**
 * The literals masked to a single placeholder before any pattern runs. Same
 * reason as the concepts guard — the value is typed, copied or filled in at
 * render time — plus SCREAMING_SNAKE_CASE, which is how every locale spells an
 * environment variable or constant name (`GITHUB_APP_PRIVATE_KEY` must not read
 * as the `Private` concept).
 */
const MASKED_LITERALS = [
  /SKILL\.md/g,
  /Skills\.sh/g,
  /skill-name/g,
  /@squad/g,
  /Agent Builder/g,
  /agent\/…/g,
  /my-workspace/g,
  /\{\{[^}]*\}\}/g,
  /`[^`]*`/g,
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g,
];

const mask = (value: string | undefined) =>
  MASKED_LITERALS.reduce((acc, pattern) => acc.replace(pattern, "…"), value ?? "");

/**
 * The tallies below are `Claim`s — numbers with the scope and pattern they were
 * measured over — so the guard re-derives each one instead of trusting the
 * sentence. The 152 round made them claims; see `./tally.ts` for the two
 * free-text tallies that were already wrong when this mechanism arrived.
 */
const CLAIM_CTX: MeasureContext = {
  locale: "ja",
  unit: "by key",
  bundles: { en, ja, ko },
  mask,
};
const claims = (locale: Locale, list: Claim[]) =>
  list.flatMap((claim) => verify(claim, { ...CLAIM_CTX, locale }));

/** True when the string talks about the term in prose. */
const namesTerm = (value: string | undefined, pattern: RegExp) => pattern.test(mask(value ?? ""));

/**
 * `_one` plural variants exist only in the English source: ja, ko and zh all
 * fill `_other` alone, so these keys are absent rather than untranslated.
 */
const PLURAL_ONE = /_one$/;

/**
 * Keys whose English source names a term the locale renders by other means, or
 * that is not prose at all. Each carries its reason.
 */
const EXEMPT: { key: string; why: string }[] = [
  {
    key: "billing.endpoints.batches",
    why: "a raw API path rendered verbatim in every locale, like billing.endpoints.buy",
  },
  {
    key: "billing.endpoints.buy",
    why: "a raw API path rendered verbatim in every locale, like billing.endpoints.batches",
  },
  {
    key: "chat.message_list.failure.provider_network",
    why: "\"the model provider\" is paraphrased as the model service; zh does the same",
  },
  {
    key: "chat.message_list.failure.provider_capacity_or_rate_limit",
    why: "\"the model provider\" is paraphrased as the model service; zh does the same",
  },
];

/**
 * Terms the bundle already renders with one native word nearly everywhere.
 * The claim is the 148 round's count *before* the outliers were converged —
 * which is why it is a `converged` claim rather than a value: the guard
 * asserts that the converged occurrences are now native ones and that no rival
 * survived, so the old number stays re-derivable from the current bundle.
 */
const MAJORITY_TERMS: {
  label: string;
  native: Record<Locale, string>;
  pattern: RegExp;
  claims: Record<Locale, Claim[]>;
}[] = [
  {
    label: "instance",
    native: { ja: "インスタンス", ko: "인스턴스" },
    pattern: /(?<![A-Za-z])instances?(?![A-Za-z])/i,
    claims: {
      ja: [
        {
          label: "instance (ja): 10 native vs 1 Latin",
          when: "converged",
          primary: { pattern: /インスタンス/, expected: 10 },
          rivals: [{ pattern: /(?<![A-Za-z])instances?(?![A-Za-z])/i, expected: 1 }],
        },
      ],
      ko: [
        {
          label: "instance (ko): 8 native vs 3 Latin",
          when: "converged",
          primary: { pattern: /인스턴스/, expected: 8 },
          rivals: [{ pattern: /(?<![A-Za-z])instances?(?![A-Za-z])/i, expected: 3 }],
        },
      ],
    },
  },
  {
    label: "desktop",
    native: { ja: "デスクトップ", ko: "데스크톱" },
    pattern: /(?<![A-Za-z])desktop(?![A-Za-z])/i,
    claims: {
      ja: [
        {
          label: "desktop (ja): 16 native vs 2 Latin",
          when: "converged",
          primary: { pattern: /デスクトップ/, expected: 16 },
          rivals: [{ pattern: /(?<![A-Za-z])desktop(?![A-Za-z])/i, expected: 2 }],
        },
      ],
      ko: [
        {
          label: "desktop (ko): 16 native vs 2 Latin",
          when: "converged",
          primary: { pattern: /데스크톱/, expected: 16 },
          rivals: [{ pattern: /(?<![A-Za-z])desktop(?![A-Za-z])/i, expected: 2 }],
        },
      ],
    },
  },
  {
    label: "provider",
    native: { ja: "プロバイダー", ko: "제공자" },
    pattern: /(?<![A-Za-z])providers?(?![A-Za-z])/i,
    claims: {
      ja: [
        {
          label: "provider (ja): 20 native vs 1 Latin",
          when: "converged",
          primary: { pattern: /プロバイダー/, expected: 20 },
          rivals: [{ pattern: /(?<![A-Za-z])providers?(?![A-Za-z])/i, expected: 1 }],
        },
      ],
      ko: [
        {
          label: "provider (ko): 19 native vs 1 Latin + 1 프로바이더",
          when: "converged",
          primary: { pattern: /제공자/, expected: 19 },
          rivals: [
            { pattern: /(?<![A-Za-z])providers?(?![A-Za-z])/i, expected: 1 },
            { pattern: /프로바이더/, expected: 1 },
          ],
        },
      ],
    },
  },
];

/**
 * Terms with no precedent in either bundle. zh had already translated each of
 * them, so the word is the standard rendering rather than a derivation from the
 * ja/ko bundles.
 */
const UNPRECEDENTED_TERMS: {
  label: string;
  native: Record<Locale, string>;
  pattern: RegExp;
  why: string;
}[] = [
  {
    label: "batch",
    native: { ja: "バッチ", ko: "배치" },
    pattern: /(?<![A-Za-z])batch(es)?(?![A-Za-z])/i,
    why: "zh says 批次, and the billing namespace already transliterates credits as クレジット / 크레딧",
  },
  {
    label: "heartbeat",
    native: { ja: "ハートビート", ko: "하트비트" },
    pattern: /(?<![A-Za-z])heartbeats?(?![A-Za-z])/i,
    why: "zh says 心跳; the runtime health copy is user-facing",
  },
  {
    label: "tier",
    native: { ja: "ティア", ko: "티어" },
    pattern: /(?<![A-Za-z])tiers?(?![A-Za-z])/i,
    why: "zh says 档位; the price-tier label and the empty state render on the billing page",
  },
];

/**
 * Terms both locales keep in Latin, where the convention is the casing. The
 * English source is itself mixed — `Pull Request` when it names the GitHub
 * event or a UI label, lowercase in prose — but each ja/ko bundle settles on
 * `Pull request` in 11 of its 12 strings, so that is what is pinned.
 */
const LATIN_CASING: {
  label: string;
  pattern: RegExp;
  settled: RegExp;
  rejected: RegExp;
  why: string;
}[] = [
  {
    label: "Pull request",
    pattern: /(?<![A-Za-z])pull requests?(?![A-Za-z])/i,
    settled: /Pull request/,
    rejected: /Pull Request/,
    why: "11 of 12 strings in each bundle already write it this way; zh keeps `Pull Request`, and ja/ko are not bound by the zh glossary",
  },
];

/**
 * A `LATIN_KEPT` term's tally, in the two halves the sentence states: how many
 * keys the Latin reaches, and how many the native form reaches.
 *
 * The two halves are measured over *different* surfaces on purpose, and that is
 * the distinction a free-text tally hid. "N keys Latin" is a claim about the
 * family — the keys whose English source names the term — because that is the
 * set the rule is asserted over. "0 native" is a claim about the whole bundle,
 * because that is what `never transliterates` checks: a native spelling
 * anywhere, in a key the English never mentions, would still be a violation.
 */
const latinKeptClaims = (
  jaNative: RegExp,
  koNative: RegExp,
  latin: RegExp,
  keys: number,
): Record<Locale, Claim[]> => ({
  ja: [
    {
      label: `Gateway-style keep (ja): ${keys} keys Latin, 0 native`,
      primary: {
        keysFrom: { locale: "en", pattern: latin, masked: true, exclude: /_one$/ },
        pattern: latin,
        expected: keys,
      },
      rivals: [{ pattern: jaNative, expected: 0 }],
    },
  ],
  ko: [
    {
      label: `Gateway-style keep (ko): ${keys} keys Latin, 0 native`,
      primary: {
        keysFrom: { locale: "en", pattern: latin, masked: true, exclude: /_one$/ },
        pattern: latin,
        expected: keys,
      },
      rivals: [{ pattern: koNative, expected: 0 }],
    },
  ],
});

/**
 * Terms both locales deliberately keep in Latin. This is the opposite shape from
 * `MAJORITY_TERMS`: there the native word is the convention and Latin is debt;
 * here Latin is the convention and the native word is the debt.
 *
 * The 147 round scanned a group of terms and recorded "checked, no action" for
 * them in prose only, which left them free to regress silently. The 149 round
 * re-checked each against both bundles and promoted the ones the bundle actually
 * answers: every English-named key renders the term in Latin in ja *and* ko, and
 * the native alternative appears zero times in either bundle. Terms where a
 * native rendering does exist are not here — `Local` (62 ローカル / 로컬 against
 * 2 `Local`, the runtime-config mode name only, whose sibling `Gateway` is a keep
 * above) is a split, not a settled keep. The 150 round re-checked that exclusion
 * and added `Webhook` from the same angle.
 *
 * The 151 round re-ran the same scan and found **one of the two exclusions was
 * wrong**. `Fleet` was excluded because "ko also writes 플릿" — but every one of
 * those hits is `템플릿`, the word for *template*, which contains `플릿` as a
 * substring. Measured properly, ko writes 플릿 zero times and ja writes フリート
 * zero times, so `Fleet` is a keep, not a split, and it is now in the table
 * below. `Local`'s exclusion survived the re-check.
 *
 * That is why `native` is a **RegExp** rather than a string. The 150 round lost a
 * measurement to the mirror-image mistake (a native pattern containing the Latin
 * form, so it matched the Latin it was meant to exclude); this round lost one to
 * a native form that is a substring of an unrelated word. A substring check
 * cannot express either distinction, and both mistakes produced a confident wrong
 * answer rather than a crash.
 */
const LATIN_KEPT: {
  label: string;
  pattern: RegExp;
  native: Record<Locale, RegExp>;
  claims: Record<Locale, Claim[]>;
}[] = [
  {
    label: "Gateway",
    pattern: /(?<![A-Za-z])Gateways?(?![A-Za-z])/,
    native: { ja: /ゲートウェイ/, ko: /게이트웨이/ },
    claims: latinKeptClaims(/ゲートウェイ/, /게이트웨이/, /(?<![A-Za-z])Gateways?(?![A-Za-z])/, 4),
  },
  {
    label: "Severity",
    pattern: /(?<![A-Za-z])Severit(y|ies)(?![A-Za-z])/,
    native: { ja: /重大度/, ko: /심각도/ },
    claims: latinKeptClaims(
      /重大度/,
      /심각도/,
      /(?<![A-Za-z])Severit(y|ies)(?![A-Za-z])/,
      2,
    ),
  },
  {
    label: "payload",
    pattern: /(?<![A-Za-z])payloads?(?![A-Za-z])/i,
    native: { ja: /ペイロード/, ko: /페이로드/ },
    /**
     * The 152 round corrected this from 2 to 3. The family has three keys —
     * `autopilots.webhook_payload.{payload,copied,truncated_marker}` — and had
     * three on the day the tally was written, so the free-text "2 keys Latin"
     * was never true and no guard could fail on it. It is a `Claim` now, and
     * the number is re-derived.
     */
    claims: latinKeptClaims(/ペイロード/, /페이로드/, /(?<![A-Za-z])payloads?(?![A-Za-z])/i, 3),
  },
  /**
   * The 150 round's addition, from the same scan angle that produced the three
   * above. It was nearly missed: a first pass counted ja as "31 Latin vs 31
   * native" because the native pattern included a lowercase `webhook`, which
   * matched the Latin occurrences themselves. Measured properly, both bundles are
   * unanimous — 31 keys each, zero ウェブフック / 웹훅 — and the Latin is spread
   * over `autopilots` (22) and `settings` (9), so it is not one surface's habit.
   */
  {
    label: "Webhook",
    pattern: /(?<![A-Za-z])[Ww]ebhooks?(?![A-Za-z])/,
    native: { ja: /ウェブフック/, ko: /웹훅/ },
    claims: latinKeptClaims(/ウェブフック/, /웹훅/, /(?<![A-Za-z])[Ww]ebhooks?(?![A-Za-z])/, 31),
  },
  /**
   * The 151 round's addition, and the correction of a wrong exclusion — see the
   * block comment above. Four keys, all under `runtimes.cloud_runtime.*`, Latin in
   * both locales. The ko pattern is guarded against `템플릿` (template), which is
   * what made the 149/150 rounds read this term as a split.
   */
  {
    label: "Fleet",
    pattern: /(?<![A-Za-z])Fleets?(?![A-Za-z])/,
    native: { ja: /フリート/, ko: /(?<!템)플릿/ },
    claims: latinKeptClaims(
      /フリート/,
      /(?<!템)플릿/,
      /(?<![A-Za-z])Fleets?(?![A-Za-z])/,
      4,
    ),
  },
];

/** Keys the English source names the term in. */
const termKeys = (pattern: RegExp) =>
  Object.keys(en).filter((key) => namesTerm(en[key], pattern));

const exemptKeys = new Set(EXEMPT.map(({ key }) => key));

const ALL_TERMS = [...MAJORITY_TERMS, ...UNPRECEDENTED_TERMS];

describe("ja / ko render each unlisted term with one native word", () => {
  for (const { label, native, pattern } of ALL_TERMS) {
    for (const locale of LOCALES) {
      it(`leaves no Latin ${label} in the ${locale} bundle`, () => {
        const offenders = Object.keys(TARGETS[locale])
          .filter((key) => !exemptKeys.has(key))
          .filter((key) => namesTerm(TARGETS[locale][key], pattern))
          .map((key) => `${key}: ${JSON.stringify(TARGETS[locale][key])}`);
        expect(offenders).toEqual([]);
      });

      it(`renders ${label} as ${native[locale]} wherever the English names it`, () => {
        const offenders = termKeys(pattern)
          .filter((key) => !exemptKeys.has(key))
          .filter((key) => !PLURAL_ONE.test(key))
          .filter((key) => !mask(TARGETS[locale][key]).includes(native[locale]))
          .map(
            (key) =>
              `${key}: expected ${JSON.stringify(native[locale])}, got ` +
              `${JSON.stringify(TARGETS[locale][key] ?? null)} (en: ${JSON.stringify(en[key])})`,
          );
        expect(offenders).toEqual([]);
      });
    }
  }

  it("re-derives the tally each majority term was derived from", () => {
    for (const { label, claims: termClaims } of MAJORITY_TERMS) {
      for (const locale of LOCALES) {
        expect(claims(locale, termClaims[locale]), `${locale} ${label}`).toEqual([]);
      }
    }
    for (const { label, why } of UNPRECEDENTED_TERMS) {
      expect(why.length, `${label} needs a reason`).toBeGreaterThan(20);
    }
  });
});

describe("ja / ko keep the Latin terms the English source ships", () => {
  for (const { label, pattern, settled, rejected } of LATIN_CASING) {
    for (const locale of LOCALES) {
      it(`never capitalises ${label} differently in the ${locale} bundle`, () => {
        const offenders = Object.keys(TARGETS[locale])
          .filter((key) => rejected.test(TARGETS[locale][key] ?? ""))
          .map((key) => `${key}: ${JSON.stringify(TARGETS[locale][key])}`);
        expect(offenders).toEqual([]);
      });

      it(`writes ${label} wherever the English names it, in ${locale}`, () => {
        const offenders = termKeys(pattern)
          .filter((key) => !exemptKeys.has(key))
          .filter((key) => !PLURAL_ONE.test(key))
          .filter((key) => !settled.test(mask(TARGETS[locale][key])))
          .map(
            (key) =>
              `${key}: expected ${settled}, got ${JSON.stringify(TARGETS[locale][key] ?? null)} ` +
              `(en: ${JSON.stringify(en[key])})`,
          );
        expect(offenders).toEqual([]);
      });
    }
  }

  it("masks SCREAMING_SNAKE_CASE, so an env var name is not read as the Private concept", () => {
    const key = "settings.repositories.github_browse_not_configured";
    expect(en[key]).toContain("GITHUB_APP_PRIVATE_KEY");
    expect(mask(en[key])).not.toMatch(/private/i);
  });

  /**
   * The complement of the test above, and the 148 round's open worry: the
   * SCREAMING_SNAKE pattern requires an underscore group, so a standalone
   * all-caps token is *not* masked. That matters because `API`, `CLI` and `URL`
   * are real prose in both bundles — a mask that swallowed them would hide the
   * Latin the term rules exist to find. Measured: the pattern matches only
   * `API_KEY`, `BASE_URL`, `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` across
   * both bundles, and `CLI` (30 ja / 23 ko), `URL` (51 / 19) and `API` (9 / 9)
   * are all left alone.
   */
  it("leaves a standalone all-caps token unmasked, so it can still be judged", () => {
    expect(mask("Run the CLI to get a URL")).toBe("Run the CLI to get a URL");
    expect(mask("API_KEY is set")).toBe("… is set");
    expect(mask("set GITHUB_APP_PRIVATE_KEY")).toBe("set …");
  });
});

/**
 * Terms both locales keep in Latin, where the native word is the debt. The
 * inverse rule from the majority terms, so it is asserted in its own block.
 */
describe("ja / ko keep the Latin terms the bundle already settled on", () => {
  for (const { label, pattern, native } of LATIN_KEPT) {
    for (const locale of LOCALES) {
      it(`keeps ${label} in Latin wherever the English names it, in ${locale}`, () => {
        const offenders = termKeys(pattern)
          .filter((key) => !PLURAL_ONE.test(key))
          .filter((key) => !pattern.test(mask(TARGETS[locale][key])))
          .map(
            (key) =>
              `${key}: expected Latin ${label}, got ${JSON.stringify(TARGETS[locale][key] ?? null)} ` +
              `(en: ${JSON.stringify(en[key])})`,
          );
        expect(offenders).toEqual([]);
      });

      it(`never transliterates ${label} in the ${locale} bundle`, () => {
        const offenders = Object.keys(TARGETS[locale])
          .filter((key) => native[locale].test(TARGETS[locale][key] ?? ""))
          .map((key) => `${key}: ${JSON.stringify(TARGETS[locale][key])}`);
        expect(offenders).toEqual([]);
      });
    }
  }

  it("re-derives the tally each Latin-kept term was derived from", () => {
    for (const { label, claims: termClaims } of LATIN_KEPT) {
      for (const locale of LOCALES) {
        expect(claims(locale, termClaims[locale]), `${locale} ${label}`).toEqual([]);
      }
    }
  });
});

/**
 * `Private` is the one term the bundle renders with *two* words, split by
 * surface rather than by accident: プライベート / 비공개 for the agent access
 * level, 非公開 / 비공개 for runtime and repository visibility. Choosing one
 * would be a guess, so only the Latin test runs — plus a consistency check that
 * the prose naming the access level uses the same word as the control that sets
 * it.
 */
describe("ja / ko never leave the Private concept in Latin", () => {
  const PRIVATE = /(?<![A-Za-z])private(?![A-Za-z])/i;

  for (const locale of LOCALES) {
    it(`leaves no Latin Private in the ${locale} bundle`, () => {
      const offenders = Object.keys(TARGETS[locale])
        .filter((key) => !exemptKeys.has(key))
        .filter((key) => namesTerm(TARGETS[locale][key], PRIVATE))
        .map((key) => `${key}: ${JSON.stringify(TARGETS[locale][key])}`);
      expect(offenders).toEqual([]);
    });

    it(`names the Private access level the way its own control does, in ${locale}`, () => {
      const label = TARGETS[locale]["agents.access.private_title"] ?? "";
      expect(label, "the access control's label must exist").toBeTruthy();
      const prose = TARGETS[locale]["agents.tab_body.composio_mcp.shared_warning"];
      expect(
        mask(prose).includes(label),
        `shared_warning should use ${JSON.stringify(label)}, got ${JSON.stringify(prose)}`,
      ).toBe(true);
    });
  }

  it("is not an enum identifier: conventions.mdx keeps only lowercase roles Latin", () => {
    const key = "agents.tab_body.composio_mcp.shared_warning";
    expect(en[key]).toMatch(/Use Private or narrow/);
    // The English capitalises it as a UI label, unlike `owner` / `admin` / `member`.
    expect(en[key]).not.toMatch(/\bprivate\b/);
  });
});

describe("the exemption list stays honest", () => {
  /**
   * There is deliberately no "ja and ko agree with each other" rule here. The
   * concepts guard needs one because ja and ko settle different concepts; these
   * terms are settled in both, so once both locales pass the per-locale word
   * rule above, agreement holds by construction and a separate rule could never
   * fail on its own. A rule that cannot fail is not a guard.
   */
  it("keeps every exemption load-bearing, so a fixed key does not stay exempt forever", () => {
    const stale: string[] = [];
    for (const { key, why } of EXEMPT) {
      // `some`, not `every`: the exemption set is shared across locales, so a key
      // is still load-bearing as long as *one* locale would trip without it.
      // Requiring both would demand the removal of an exemption that the other
      // locale still needs — a false red that no edit could clear.
      const wouldStillTrip = LOCALES.some((locale) =>
        ALL_TERMS.some(
          ({ native, pattern }) =>
            namesTerm(TARGETS[locale][key], pattern) ||
            (termKeys(pattern).includes(key) &&
              !PLURAL_ONE.test(key) &&
              !mask(TARGETS[locale][key]).includes(native[locale])),
        ),
      );
      if (!wouldStillTrip) stale.push(`${key} no longer needs its exemption: ${why}`);
    }
    expect(stale).toEqual([]);
  });
});
