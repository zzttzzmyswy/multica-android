import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guard for the ja and ko bundles rendering a *concept* with one word.
 *
 * The zh bundle has a glossary (conventions.mdx section 2) and a guard per
 * bundle; ja and ko have neither. The 145 round derived their convention from
 * the bundles instead: both translate the `skill` and `squad` concepts with a
 * native word — ja `スキル` / `スクワッド`, ko `스킬` / `스쿼드` — in ~100 and
 * ~45 keys respectively, and the handful of Latin survivors were either
 * literals or leftovers. Leftovers collapsed, literals pinned below.
 *
 * The rule is deliberately narrow: it only asks that a concept the English
 * source names is rendered with the same native word every other string in the
 * same bundle uses. It says nothing about *which* word — that is the locale
 * owner's call, and ja/ko are not bound by the zh glossary.
 *
 * Latin that stays is closed and each entry carries its reason, so a new
 * English word fails this suite until someone classifies it.
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

/**
 * A bare concept word, not part of a longer token. The literals are masked out
 * first (below) rather than fenced off with lookarounds: a lookahead broad
 * enough to exclude `SKILL.md` also excludes `… this skill.` at the end of a
 * sentence, which is exactly the prose this guard exists for.
 */
const CONCEPTS: { label: string; native: Record<Locale, string>; pattern: RegExp }[] = [
  {
    label: "skill",
    native: { ja: "スキル", ko: "스킬" },
    pattern: /(?<![A-Za-z])skills?(?![A-Za-z])/i,
  },
  {
    label: "squad",
    native: { ja: "スクワッド", ko: "스쿼드" },
    pattern: /(?<![A-Za-z])squads?(?![A-Za-z])/i,
  },
];

/**
 * The literals the two locales keep in Latin, masked to a single placeholder
 * before any pattern runs. Each is a value the user types, copies or is handed
 * — `SKILL.md` is the file the editor writes, `Skills.sh` a host name,
 * `skill-name` the slug a field expects, `@squad` a mention token.
 */
const MASKED_LITERALS = [/SKILL\.md/g, /Skills\.sh/g, /skill-name/g, /@squad/g];

const mask = (value: string) =>
  MASKED_LITERALS.reduce((acc, pattern) => acc.replace(pattern, "…"), value);

/** True when the string talks about the concept in prose. */
const namesConcept = (value: string | undefined, pattern: RegExp) =>
  pattern.test(mask(value ?? ""));

/**
 * Latin the two locales keep on purpose. Each is a value the user types or
 * copies, not prose about the concept.
 */
const KEPT_LATIN: { key: string; why: string }[] = [
  {
    key: "skills.detail.name_placeholder",
    why: "`skill-name` is the slug example the field expects, shown as-is in every locale",
  },
];

/**
 * `_one` plural variants exist only in the English source: ja, ko and zh all
 * fill `_other` alone, so these keys are absent rather than untranslated.
 */
const PLURAL_ONE = /_one$/;

const keptLatinKeys = new Set(KEPT_LATIN.map(({ key }) => key));
const conceptKeys = (pattern: RegExp) =>
  Object.keys(en).filter((key) => namesConcept(en[key], pattern));

describe("ja / ko render each concept with one native word", () => {
  for (const { label, native, pattern } of CONCEPTS) {
    for (const locale of ["ja", "ko"] as const) {
      it(`leaves no Latin ${label} in the ${locale} bundle`, () => {
        const offenders = Object.keys(TARGETS[locale])
          .filter((key) => !keptLatinKeys.has(key))
          .filter((key) => namesConcept(TARGETS[locale][key], pattern))
          .map((key) => `${key}: ${JSON.stringify(TARGETS[locale][key])}`);
        expect(offenders).toEqual([]);
      });

      it(`renders ${label} as ${native[locale]} wherever the English names it`, () => {
        const offenders = conceptKeys(pattern)
          .filter((key) => !keptLatinKeys.has(key))
          .filter((key) => !PLURAL_ONE.test(key))
          .filter((key) => !(TARGETS[locale][key] ?? "").includes(native[locale]))
          .map(
            (key) =>
              `${key}: expected ${JSON.stringify(native[locale])}, got ` +
              `${JSON.stringify(TARGETS[locale][key] ?? null)} (en: ${JSON.stringify(en[key])})`,
          );
        expect(offenders).toEqual([]);
      });
    }
  }

  it("keeps each retained Latin value literal, so nobody 'fixes' it by accident", () => {
    const offenders = KEPT_LATIN.flatMap(({ key }) =>
      Object.entries(TARGETS)
        .filter(([, bundle]) => !(bundle[key] ?? "").includes("skill-name"))
        .map(([locale]) => `${locale} ${key}: no longer the literal "skill-name"`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("ja and ko agree with each other on the concepts", () => {
  it("renders the same English string with the same native word", () => {
    const offenders: string[] = [];
    for (const { label, native, pattern } of CONCEPTS) {
      for (const key of conceptKeys(pattern)) {
        if (keptLatinKeys.has(key) || PLURAL_ONE.test(key)) continue;
        const jaHas = (ja[key] ?? "").includes(native.ja);
        const koHas = (ko[key] ?? "").includes(native.ko);
        if (jaHas !== koHas) {
          offenders.push(
            `${label} ${key}: ja=${JSON.stringify(ja[key] ?? null)} ko=${JSON.stringify(ko[key] ?? null)}`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
