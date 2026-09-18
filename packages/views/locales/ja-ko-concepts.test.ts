import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { measure, verify, type Claim, type Fact, type MeasureContext } from "./tally";

/**
 * Guard for the ja and ko bundles rendering a *concept* with one word.
 *
 * The zh bundle has a glossary (conventions.mdx section 2) and a guard per
 * bundle; ja and ko have neither. The 145 round derived their convention from
 * the bundles instead for `skill` and `squad`; the 146 round did the same for
 * the rest of section 2. The derivation is always the same question: does the
 * bundle render this concept with one word, and does the English source's word
 * survive anywhere it should not?
 *
 * The rule is deliberately narrow: it only asks that a concept the English
 * source names is rendered with the same native word every other string in the
 * same bundle uses. It says nothing about *which* word — that is the locale
 * owner's call, and ja/ko are not bound by the zh glossary.
 *
 * Two concepts resist a single word, and both are encoded rather than guessed:
 *
 * - ko `label` is split 26 `라벨` / 25 `레이블` with no majority and no clean
 *   scope partition (`settings.*` mostly takes `레이블`, `issues.*` mostly
 *   `라벨`, and `modals.create_issue` takes both). The bundle cannot settle it,
 *   so `native.ko` is null: the Latin test still runs, the single-word test
 *   does not. See `UNSETTLED` below.
 * - ko `reply` is split by surface, not by accident: `답글` for a reply to an
 *   issue comment, `답변` for the agent's reply in chat, with zero crossover.
 *   That partition is the rule, so it is guarded as one (SURFACE_SPLITS).
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
const LOCALES = ["ja", "ko"] as const;

/**
 * A bare concept word, not part of a longer token. The literals are masked out
 * first (below) rather than fenced off with lookarounds: a lookahead broad
 * enough to exclude `SKILL.md` also excludes `… this skill.` at the end of a
 * sentence, which is exactly the prose this guard exists for.
 */
const CONCEPTS: {
  label: string;
  native: Record<Locale, string | null>;
  pattern: RegExp;
}[] = [
  { label: "workspace", native: { ja: "ワークスペース", ko: "워크스페이스" }, pattern: /(?<![A-Za-z])workspaces?(?![A-Za-z])/i },
  { label: "agent", native: { ja: "エージェント", ko: "에이전트" }, pattern: /(?<![A-Za-z])agents?(?![A-Za-z])/i },
  { label: "project", native: { ja: "プロジェクト", ko: "프로젝트" }, pattern: /(?<![A-Za-z])projects?(?![A-Za-z])/i },
  { label: "autopilot", native: { ja: "オートパイロット", ko: "오토파일럿" }, pattern: /(?<![A-Za-z])autopilots?(?![A-Za-z])/i },
  { label: "daemon", native: { ja: "デーモン", ko: "데몬" }, pattern: /(?<![A-Za-z])daemons?(?![A-Za-z])/i },
  { label: "runtime", native: { ja: "ランタイム", ko: "런타임" }, pattern: /(?<![A-Za-z])runtimes?(?![A-Za-z])/i },
  { label: "inbox", native: { ja: "インボックス", ko: "인박스" }, pattern: /(?<![A-Za-z])inbox(?![A-Za-z])/i },
  { label: "comment", native: { ja: "コメント", ko: "댓글" }, pattern: /(?<![A-Za-z])comments?(?![A-Za-z])/i },
  { label: "reply", native: { ja: "返信", ko: "답변" }, pattern: /(?<![A-Za-z])repl(y|ies)(?![A-Za-z])/i },
  { label: "member", native: { ja: "メンバー", ko: "멤버" }, pattern: /(?<![A-Za-z])members?(?![A-Za-z])/i },
  { label: "label", native: { ja: "ラベル", ko: null }, pattern: /(?<![A-Za-z])labels?(?![A-Za-z])/i },
  { label: "settings", native: { ja: "設定", ko: "설정" }, pattern: /(?<![A-Za-z])settings?(?![A-Za-z])/i },
  { label: "notifications", native: { ja: "通知", ko: "알림" }, pattern: /(?<![A-Za-z])notifications?(?![A-Za-z])/i },
  { label: "onboarding", native: { ja: null, ko: null }, pattern: /(?<![A-Za-z])onboarding(?![A-Za-z])/i },
];

/**
 * `ko` renders the `reply` concept with two words on purpose. A reply to an
 * issue comment is `답글`; the agent's reply in chat is `답변`. Ten chat keys and
 * five comment keys, with no crossover in either direction — that partition is
 * the convention, so it is asserted instead of being collapsed to one word.
 */
const SURFACE_SPLITS: {
  label: string;
  locale: Locale;
  native: string;
  keys: RegExp;
  why: string;
}[] = [
  {
    label: "reply",
    locale: "ko",
    native: "답글",
    keys: /^(issues\.comment\.|issues\.reply\.|settings\.shortcuts\.actions\.send\.)/,
    why: "ko names a reply to an issue comment 답글, and the agent's chat reply 답변",
  },
];

/**
 * Concepts the bundle cannot settle. The Latin test still applies; the
 * single-word test does not, because choosing a winner here would be a guess
 * rather than a derivation. Both were reported upstream instead.
 *
 * A `why` that states a number carries a `claim` for it, and the guard
 * re-derives it. The 152 round added that after finding the `label` entry
 * reading "26 `라벨` vs 24 `레이블`" — the bundle holds 25, and the ledger one
 * file over has said 25 since the 149 round. Two files disagreed about the same
 * split and only the one with a re-derivable number was right; see `./tally.ts`.
 */
const UNSETTLED: { label: string; locale: Locale; why: string; claims?: Fact[] }[] = [
  {
    label: "label",
    locale: "ko",
    why:
      "26 `라벨` vs 25 `레이블` with no majority and no scope partition: `settings.*` mostly " +
      "takes `레이블` and `issues.*` mostly `라벨`, but `modals.create_issue` takes both and " +
      "`labels.remove_label` disagrees with its own namespace. Needs a locale owner's call.",
    claims: [
      { label: "라벨 keys", pattern: /라벨/, expected: 26 },
      { label: "레이블 keys", pattern: /레이블/, expected: 25 },
    ],
  },
  {
    label: "onboarding",
    locale: "ja",
    why: "only two English strings name the concept — too few to derive a convention from",
  },
  {
    label: "onboarding",
    locale: "ko",
    why: "only two English strings name the concept — too few to derive a convention from",
  },
];

/**
 * The literals the two locales keep in Latin, masked to a single placeholder
 * before any pattern runs. Each is a value the user types, copies or is handed
 * — `SKILL.md` is the file the editor writes, `Skills.sh` a host name,
 * `skill-name` the slug a field expects, `@squad` a mention token, `Agent
 * Builder` a product name, `agent/…` a branch prefix, `my-workspace` a slug.
 * Placeholders and inline code are masked for the same reason: the value is
 * filled in at render time or is a command the user copies verbatim.
 */
const MASKED_LITERALS = [
  /SKILL\.md/g,
  /Skills\.sh/g,
  /skill-name/g,
  /@squad/g,
  /Agent Builder/g,
  /agent\/…/g,
  /agent --model[^`]*/g,
  /my-workspace/g,
  /Acme Inc/g,
  /My Lab/g,
  /Side Projects/g,
  /\{\{[^}]*\}\}/g,
  /`[^`]*`/g,
];

const mask = (value: string | undefined) =>
  MASKED_LITERALS.reduce((acc, pattern) => acc.replace(pattern, "…"), value ?? "");

const claimCtx = (locale: Locale): MeasureContext => ({
  locale,
  unit: "by key",
  bundles: { en, ja, ko },
  mask,
});

const problems = (locale: Locale, facts: Fact[]) =>
  facts.flatMap((fact) => {
    const measured = measure(fact, claimCtx(locale));
    return measured === fact.expected
      ? []
      : [`${locale} / ${fact.label}: states ${fact.expected}, the bundle has ${measured}`];
  });

/** True when the string talks about the concept in prose. */
const namesConcept = (value: string | undefined, pattern: RegExp) => pattern.test(mask(value ?? ""));

/**
 * `_one` plural variants exist only in the English source: ja, ko and zh all
 * fill `_other` alone, so these keys are absent rather than untranslated.
 */
const PLURAL_ONE = /_one$/;

/**
 * Latin the two locales keep on purpose, and keys whose English source names a
 * concept the locale renders by other means. Each carries its reason.
 */
const EXEMPT: { key: string; why: string }[] = [
  {
    key: "skills.detail.name_placeholder",
    why: "`skill-name` is the slug example the field expects, shown as-is in every locale",
  },
  {
    key: "invite.main.invited_role_member",
    why: "`member` here is the role identifier, which conventions.mdx keeps lowercase English",
  },
  {
    key: "invite.batch.row_invited_member",
    why: "`member` here is the role identifier, which conventions.mdx keeps lowercase English",
  },
  {
    key: "settings.github.feature_co_author_description_suffix",
    why: "a sentence fragment: the concept moved into the sibling `_prefix` key",
  },
  {
    key: "agents.tab_body.skills.intro",
    why: "\"Workspace skills\" is paraphrased as this agent's effective skill set",
  },
  {
    key: "issues.detail.unsubscribe_subtree_unsupported",
    why: "\"This workspace's server\" is paraphrased as the current server",
  },
  {
    key: "issues.detail.thread_nav_label",
    why: "\"comment thread\" is the thread concept, not the comment concept",
  },
  {
    key: "issues.detail.thread_nav.button_label_other",
    why: "\"comment thread\" is the thread concept, not the comment concept",
  },
  {
    key: "agents.tab_body.mcp_config.runtime_hint",
    why: "the concept is the `{{runtime}}` placeholder, filled with the runtime's own name",
  },
  {
    key: "agents.tab_body.skills.runtime_hint",
    why: "the concept is the `{{runtime}}` placeholder, filled with the runtime's own name",
  },
  {
    key: "chat.message_list.failure.runtime_version_unsupported",
    why: "\"for this runtime\" is the sentence's context; both locales drop the noun",
  },
  {
    key: "billing.workspace.current.members",
    why: "\"Human members\" is the billing seat count; both locales say user seats",
  },
  {
    key: "agents.access.workspace_desc",
    why: "\"All workspace members\" is paraphrased as everyone; both locales agree",
  },
  {
    key: "billing.workspace.current.member_count_other",
    why: "ja counts people with the 名 counter and needs no noun after the seat header",
  },
  {
    key: "autopilots.detail.run_blocked_attribution",
    why: "ja renders \"a responsible member\" as the role 責任者",
  },
  {
    key: "onboarding.welcome_after_onboarding.skip.loading",
    why: "\"Setting up\" is the verb, not the Settings concept",
  },
];

/**
 * Developer-facing strings that are identical in en, zh, ja and ko: raw API
 * output and identifiers, not prose anyone translates.
 */
const RAW_STRINGS = [
  "billing.balance.meta",
  "billing.batches.remaining_over_total",
  "billing.buy.tier_money_to_credits",
  "billing.checkout.charged_value",
  "billing.endpoints.buy",
  "billing.topups.amount_to_credits",
  "billing.topups.row_meta",
  "billing.transactions.row_meta",
  "onboarding.questions.source.ai_assistant",
];

const exemptKeys = new Set(EXEMPT.map(({ key }) => key));
const splitFor = (label: string, locale: Locale) =>
  SURFACE_SPLITS.find((split) => split.label === label && split.locale === locale);
const isSettled = (label: string, locale: Locale) =>
  !UNSETTLED.some((entry) => entry.label === label && entry.locale === locale);

/**
 * The 146 round's convergences, as claims. That round folded each of these onto
 * the word the bundle already used everywhere else and recorded what it measured
 * first — in the commit message and in this suite's prose, where nothing could
 * re-derive it. The 148 round recorded the same kind of number as a `converged`
 * claim instead; these are the ones it left behind, found by the 153 round's
 * sweep of every convergence between 142 and 152.
 *
 * The scope is the suite's own rule — the keys whose *English* source names the
 * concept — so the claim is measured over exactly the strings the assertions
 * above are about. `PLURAL_ONE` is excluded because those keys are absent rather
 * than untranslated; the `EXEMPT` list is not, and does not need to be: every
 * exempt key that the English names the concept in already carried the native
 * word before the convergence, so it sits on both sides of the sum.
 *
 * Five of the 146 round's convergences are **not** here, and the reason is the
 * same for all five: the rival never reached zero, so the arithmetic a
 * convergence asserts does not hold. `runtime` left one rival behind and `agent`
 * left seven, in both locales; ko `inbox` and ja `autopilot` gained the native
 * word on two keys that had neither form before, so the primary grew by more
 * than the rivals could account for. Those four are pinned by the zero-exception
 * assertions above instead, which is the part that matters for the rule — what
 * is lost is only the before-count, and inventing one would be worse than not
 * having it.
 */
const CONVERGED: {
  label: string;
  locale: Locale;
  native: number;
  rivals: { pattern: RegExp; expected: number }[];
}[] = [
  {
    label: "daemon",
    locale: "ja",
    native: 28,
    rivals: [{ pattern: /(?<![A-Za-z])daemons?(?![A-Za-z])/i, expected: 5 }],
  },
  {
    label: "daemon",
    locale: "ko",
    native: 28,
    rivals: [{ pattern: /(?<![A-Za-z])daemons?(?![A-Za-z])/i, expected: 5 }],
  },
  { label: "inbox", locale: "ja", native: 13, rivals: [{ pattern: /受信トレイ/, expected: 2 }] },
  { label: "member", locale: "ko", native: 80, rivals: [{ pattern: /구성원/, expected: 8 }] },
  { label: "reply", locale: "ja", native: 17, rivals: [{ pattern: /回答|応答/, expected: 2 }] },
];

const convergedClaim = ({
  label,
  locale,
  native,
  rivals,
}: (typeof CONVERGED)[number]): Claim => {
  const concept = CONCEPTS.find((entry) => entry.label === label);
  if (concept === undefined) throw new Error(`no concept named ${label}`);
  if (concept.native[locale] === null) throw new Error(`${label} has no ${locale} word to claim`);
  const scope = { locale: "en", pattern: concept.pattern, masked: true, exclude: PLURAL_ONE };
  return {
    label: `${label} (${locale}): ${native} native vs ${rivals.map((r) => r.expected).join(" + ")} rival`,
    when: "converged",
    primary: { keysFrom: scope, pattern: new RegExp(concept.native[locale]), expected: native },
    rivals: rivals.map((rival) => ({ keysFrom: scope, pattern: rival.pattern, expected: rival.expected })),
  };
};

/** Keys the English source names the concept in. */
const conceptKeys = (pattern: RegExp) =>
  Object.keys(en).filter((key) => namesConcept(en[key], pattern));

describe("ja / ko render each concept with one native word", () => {
  for (const { label, native, pattern } of CONCEPTS) {
    for (const locale of LOCALES) {
      it(`leaves no Latin ${label} in the ${locale} bundle`, () => {
        const offenders = Object.keys(TARGETS[locale])
          .filter((key) => !exemptKeys.has(key))
          .filter((key) => namesConcept(TARGETS[locale][key], pattern))
          .map((key) => `${key}: ${JSON.stringify(TARGETS[locale][key])}`);
        expect(offenders).toEqual([]);
      });

      const word = native[locale];
      if (word === null) continue;

      it(`renders ${label} as ${word} wherever the English names it`, () => {
        const split = splitFor(label, locale);
        const offenders = conceptKeys(pattern)
          .filter((key) => !exemptKeys.has(key))
          .filter((key) => !PLURAL_ONE.test(key))
          .filter((key) => !split?.keys.test(key))
          .filter((key) => !mask(TARGETS[locale][key]).includes(word))
          .map(
            (key) =>
              `${key}: expected ${JSON.stringify(word)}, got ` +
              `${JSON.stringify(TARGETS[locale][key] ?? null)} (en: ${JSON.stringify(en[key])})`,
          );
        expect(offenders).toEqual([]);
      });
    }
  }

  for (const { label, locale, native, keys, why } of SURFACE_SPLITS) {
    it(`splits ${label} by surface in ${locale}: ${why}`, () => {
      const pattern = CONCEPTS.find((concept) => concept.label === label)!.pattern;
      const offenders = conceptKeys(pattern)
        .filter((key) => keys.test(key))
        .filter((key) => !PLURAL_ONE.test(key))
        .filter((key) => !mask(TARGETS[locale][key]).includes(native))
        .map(
          (key) =>
            `${key}: expected ${JSON.stringify(native)}, got ` +
            `${JSON.stringify(TARGETS[locale][key] ?? null)} (en: ${JSON.stringify(en[key])})`,
        );
      expect(offenders).toEqual([]);
    });
  }

  it("records which concepts the bundle cannot settle, so nobody guesses", () => {
    expect(UNSETTLED.map(({ label, locale }) => `${locale} ${label}`).sort()).toEqual([
      "ja onboarding",
      "ko label",
      "ko onboarding",
    ]);
    for (const { label, locale } of UNSETTLED) {
      const concept = CONCEPTS.find((entry) => entry.label === label);
      expect(concept, `${label} must stay in CONCEPTS`).toBeDefined();
      expect(isSettled(label, locale), `${locale} ${label} must have a null native word`).toBe(
        concept!.native[locale] !== null,
      );
    }
  });

  it("re-derives every number the unsettled reasons state", () => {
    // The `label` entry carried "26 라벨 vs 24 레이블" for as long as it existed,
    // and the bundle holds 25 — a free-text number nothing could contradict. The
    // rule is now structural: a reason that states a count has to carry the
    // claim that re-derives it.
    for (const { label, locale, why, claims: entryClaims } of UNSETTLED) {
      if (!/\d/.test(why)) continue;
      expect(
        entryClaims,
        `${locale} ${label}'s reason states a number but carries no claim for it`,
      ).toBeDefined();
      expect(problems(locale, entryClaims!), `${locale} ${label}`).toEqual([]);
    }
  });

  it("re-derives the before-counts of the 146 round's convergences", () => {
    // Same rule, the other direction: a convergence's before-count is a number
    // nothing can re-measure, so it has to be one the current bundle still adds
    // up to. See `CONVERGED` for the five the round performed that this cannot
    // state, and why.
    for (const entry of CONVERGED) {
      const claim = convergedClaim(entry);
      expect(verify(claim, claimCtx(entry.locale)), claim.label).toEqual([]);
    }
  });

  it("keeps each retained Latin value literal, so nobody 'fixes' it by accident", () => {
    const offenders = EXEMPT.filter(({ key }) => key === "skills.detail.name_placeholder").flatMap(
      ({ key }) =>
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
      if (!isSettled(label, "ja") || !isSettled(label, "ko")) continue;
      if (native.ja === null || native.ko === null) continue;
      const split = splitFor(label, "ko");
      for (const key of conceptKeys(pattern)) {
        if (exemptKeys.has(key) || PLURAL_ONE.test(key) || split?.keys.test(key)) continue;
        const jaHas = mask(ja[key] ?? "").includes(native.ja);
        const koHas = mask(ko[key] ?? "").includes(native.ko);
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

describe("ja and ko translate every prose string the English bundle ships", () => {
  const prose = (value: string | undefined) =>
    (value ?? "").replace(/\{\{[^}]*\}\}/g, "X").trim().split(/\s+/).filter(Boolean).length >= 4;

  for (const locale of LOCALES) {
    it(`translates every prose string in ${locale}`, () => {
      const offenders = Object.keys(en)
        .filter((key) => TARGETS[locale][key] === en[key] && prose(en[key]))
        .filter((key) => !RAW_STRINGS.includes(key))
        .map((key) => `${key}: ${JSON.stringify(en[key])}`);
      expect(offenders).toEqual([]);
    });
  }

  it("keeps the raw developer strings identical in every locale", () => {
    const zh = load("zh-Hans");
    const offenders = RAW_STRINGS.filter((key) =>
      [ja, ko, zh].some((bundle) => (bundle[key] ?? en[key]) !== en[key]),
    );
    expect(offenders).toEqual([]);
  });
});
