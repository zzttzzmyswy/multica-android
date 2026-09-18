import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
 *   converged and the majority is now pinned. `tally` records what the 148
 *   round measured before the convergence.
 * - `UNPRECEDENTED_TERMS` — neither bundle had any precedent and zh had already
 *   translated the term. The native word is the standard rendering, not a
 *   derivation, and the reason says so.
 *
 * `LATIN_CASING` is a third shape: a term both locales keep in Latin, where the
 * convention is which letters are capitalised.
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
 * `tally` is the count the 148 round measured *before* the outliers were
 * converged, so a later reader can see how lopsided the derivation was.
 */
const MAJORITY_TERMS: {
  label: string;
  native: Record<Locale, string>;
  pattern: RegExp;
  tally: Record<Locale, string>;
}[] = [
  {
    label: "instance",
    native: { ja: "インスタンス", ko: "인스턴스" },
    pattern: /(?<![A-Za-z])instances?(?![A-Za-z])/i,
    tally: { ja: "10 native vs 1 Latin", ko: "8 native vs 3 Latin" },
  },
  {
    label: "desktop",
    native: { ja: "デスクトップ", ko: "데스크톱" },
    pattern: /(?<![A-Za-z])desktop(?![A-Za-z])/i,
    tally: { ja: "16 native vs 2 Latin", ko: "16 native vs 2 Latin" },
  },
  {
    label: "provider",
    native: { ja: "プロバイダー", ko: "제공자" },
    pattern: /(?<![A-Za-z])providers?(?![A-Za-z])/i,
    tally: { ja: "20 native vs 1 Latin", ko: "19 native vs 1 Latin + 1 프로바이더" },
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

const exemptKeys = new Set(EXEMPT.map(({ key }) => key));

/** Keys the English source names the term in. */
const termKeys = (pattern: RegExp) =>
  Object.keys(en).filter((key) => namesTerm(en[key], pattern));

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

  it("records the tally each majority term was derived from", () => {
    for (const { label, tally } of MAJORITY_TERMS) {
      for (const locale of LOCALES) {
        expect(tally[locale], `${locale} ${label} needs a tally`).toMatch(/\d+ native vs \d+/);
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
      // Every locale, not just one: the exemption is shared across locales, so a
      // single locale translating the key would otherwise keep it alive.
      const wouldStillTrip = LOCALES.every((locale) =>
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
