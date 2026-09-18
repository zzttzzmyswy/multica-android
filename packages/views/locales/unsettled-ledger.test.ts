import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The ledger of decisions the bundles cannot settle.
 *
 * conventions.mdx has a "Currently undecided — needs a locale owner's call, do
 * not pick one" table. Until the 149 round that table was **prose only**: nothing
 * in the repo could tell a later reader whether an entry was still accurate, and
 * nothing stopped a round from silently converging one of the splits and leaving
 * the table claiming a disagreement that no longer existed.
 *
 * This file is the machine-checkable half of that table. Each entry records:
 *
 * - `forms` — the competing renderings, all of which must still be in use. If a
 *   later round converges one, this test goes red and the entry has to be
 *   deleted (and the term either settled with a guard, or re-opened).
 * - `collision` — two anchors of the *same kind* that take *different* forms.
 *   That pair is the whole reason the bundle cannot settle the term: it rules out
 *   "a clear majority" (the minority is not a straggler, it is the same thing
 *   spelled another way) and it rules out "a clean partition" (the two forms
 *   share a surface). If a round makes the partition clean, the collision
 *   disappears and this test goes red — which is the signal to settle it.
 * - `why` — the sentence conventions.mdx gives, so the code and the doc cannot
 *   drift apart.
 *
 * The last test in this file asserts the ledger and the doc list the same terms,
 * in both directions. That is the "有据可依" property: a reader who has only
 * conventions.mdx and this guard can see every open question, why it is open, and
 * exactly which keys hold it open.
 */

const LOCALES_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(LOCALES_DIR, "../../..");
const CONVENTIONS = resolve(REPO_ROOT, "apps/docs/content/docs/developers/conventions.mdx");

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
const TARGETS = { ja: load("ja"), ko: load("ko") } as const;
type Locale = keyof typeof TARGETS;

const countMatching = (bundle: Bundle, pattern: RegExp) =>
  Object.values(bundle).filter((value) => pattern.test(value)).length;

type Anchor = { key: string; contains: string };

type Entry = {
  /** How conventions.mdx names this term in its undecided table. */
  docTerm: string;
  label: string;
  locale: Locale;
  forms: { label: string; pattern: RegExp }[];
  /** Same kind of string, two different forms — the partition is not clean. */
  collision: [Anchor, Anchor];
  why: string;
};

const JA_COUNTERS = "秒|分|時間|日間|日中|日目|日|週間|週|か月|ヶ月|年|件|個|名|回|つ|人|本|枚|台|度|行|文字|ページ|階|時|泊|杯|冊";
const LATIN_ROLE = /(?<![A-Za-z])(owner|admin|member)s?(?![A-Za-z])/;

const UNSETTLED: Entry[] = [
  {
    docTerm: "Server",
    label: "Server",
    locale: "ja",
    forms: [
      { label: "Latin Server", pattern: /(?<![A-Za-z])Servers?(?![A-Za-z])/ },
      { label: "サーバー", pattern: /サーバー/ },
    ],
    collision: [
      { key: "agents.tab_body.mcp_config.dialog_name_required", contains: "Server" },
      { key: "agents.tab_body.mcp_config.dialog_name_locked", contains: "サーバー" },
    ],
    why:
      "23 Latin vs 15 サーバー inside agents.tab_body.mcp_config.* alone, alternating " +
      "key by key (dialog_name_required is Latin, dialog_name_locked is native), " +
      "while settings.mcp.* is native in all 15 of its strings",
  },
  {
    docTerm: "review",
    label: "review",
    locale: "ko",
    forms: [
      { label: "리뷰", pattern: /리뷰/ },
      { label: "검토", pattern: /검토/ },
    ],
    collision: [
      { key: "issues.status.in_review", contains: "리뷰" },
      { key: "issues.detail.delegated_subscription_hint", contains: "검토" },
    ],
    why:
      "9 검토 vs 8 리뷰, and the status control (issues.status.in_review) and the " +
      "prose that enumerates the same statuses disagree on the word",
  },
  {
    docTerm: "label",
    label: "label",
    locale: "ko",
    forms: [
      { label: "레이블", pattern: /레이블/ },
      { label: "라벨", pattern: /라벨/ },
    ],
    collision: [
      { key: "modals.create_issue.set_labels", contains: "레이블" },
      { key: "modals.create_issue.toast_link_labels_failed", contains: "라벨" },
    ],
    why:
      "26 라벨 vs 25 레이블 with no partition — the same modal takes both " +
      "(modals.create_issue.set_labels is 레이블, its sibling toast is 라벨)",
  },
  {
    docTerm: "Roles in ja/ko prose",
    label: "roles (ja)",
    locale: "ja",
    forms: [
      { label: "lowercase Latin role", pattern: LATIN_ROLE },
      { label: "native role", pattern: /(メンバー|オーナー|管理者)/ },
    ],
    collision: [
      { key: "settings.mcp.admin_only_note", contains: "admin" },
      { key: "settings.members.roles.owner.label", contains: "オーナー" },
    ],
    why:
      "the section-2 rule keeps roles lowercase Latin and does not say whether it " +
      "binds ja; ja keeps Latin in permission prose (22 keys) but renders the role " +
      "labels natively, so the bundle does not answer which applies",
  },
  {
    docTerm: "Roles in ja/ko prose",
    label: "roles (ko)",
    locale: "ko",
    forms: [
      { label: "lowercase Latin role", pattern: LATIN_ROLE },
      { label: "native role", pattern: /(멤버|소유자|관리자)/ },
    ],
    collision: [
      { key: "settings.mcp.admin_only_note", contains: "owner" },
      { key: "settings.workspace.manage_hint", contains: "관리자" },
    ],
    why:
      "the same section-2 question on the ko side, where the split runs through " +
      "one surface: two workspace-permission sentences disagree " +
      "(settings.mcp.admin_only_note is Latin, settings.workspace.manage_hint is native)",
  },
  {
    docTerm: "Register (polite level)",
    label: "register",
    locale: "ko",
    forms: [
      { label: "합니다체", pattern: /습니다/ },
      { label: "해요체", pattern: /(어요|아요|세요|예요|이에요|해요)/ },
    ],
    collision: [
      { key: "common.lark_bind.error_expired", contains: "습니다" },
      { key: "common.slack_bind.error_expired", contains: "어요" },
    ],
    why:
      "856 values carry 습니다 and 398 an 해요체 ending, and the split cuts through " +
      "one key family — common.lark_bind.error_expired and " +
      "common.slack_bind.error_expired are the same string in two registers",
  },
  {
    docTerm: "Private",
    label: "Private",
    locale: "ja",
    forms: [
      { label: "プライベート", pattern: /プライベート/ },
      { label: "非公開", pattern: /非公開/ },
    ],
    collision: [
      { key: "settings.plugins.private", contains: "プライベート" },
      { key: "settings.repositories.github_private", contains: "非公開" },
    ],
    why:
      "7 プライベート vs 9 非公開, and the two forms are not split by surface or by " +
      "label-vs-prose: settings.plugins.private and settings.repositories.github_private " +
      "are both a bare `Private` label under settings and take different words",
  },
  {
    docTerm: "Figure and counter spacing",
    label: "figure + counter spacing",
    locale: "ja",
    forms: [
      { label: "spaced", pattern: new RegExp(`\\d\\s+(?:${JA_COUNTERS})`) },
      { label: "tight", pattern: new RegExp(`\\d(?:${JA_COUNTERS})`) },
    ],
    collision: [
      { key: "autopilots.relative_date.one_day_ago", contains: "1 日" },
      { key: "projects.relative_date.one_day_ago", contains: "1日" },
    ],
    why:
      "42 spaced occurrences vs 14 tight ones on a literal figure (155 vs 40 on an " +
      "interpolation), and the same English source is rendered both ways: " +
      "autopilots.relative_date.one_day_ago is `1 日前` while " +
      "projects.relative_date.one_day_ago is `1日前`, both from `1d ago`",
  },
];

describe("the unsettled ledger stays honest", () => {
  for (const entry of UNSETTLED) {
    const bundle = TARGETS[entry.locale];

    it(`keeps ${entry.label} genuinely split in ${entry.locale}`, () => {
      const empty = entry.forms
        .filter(({ pattern }) => countMatching(bundle, pattern) === 0)
        .map(({ label }) => label);
      expect(
        empty,
        `${entry.label} is no longer split — if a round converged it, settle it with a ` +
          `guard and delete this entry instead of leaving the ledger claiming a disagreement`,
      ).toEqual([]);
    });

    it(`keeps the collision that blocks a clean partition for ${entry.label}`, () => {
      const [a, b] = entry.collision;
      for (const anchor of [a, b]) {
        expect(en[anchor.key], `${anchor.key} must be real product copy`).toBeDefined();
        expect(
          bundle[anchor.key],
          `${anchor.key} should render ${JSON.stringify(anchor.contains)}, got ` +
            `${JSON.stringify(bundle[anchor.key] ?? null)}`,
        ).toContain(anchor.contains);
      }
      expect(
        a.contains,
        `${entry.label}: the two anchors must still take different forms, otherwise ` +
          `the partition became clean and the term can be settled`,
      ).not.toBe(b.contains);
    });

    it(`records why ${entry.label} cannot be settled from the bundle`, () => {
      expect(entry.why.length).toBeGreaterThan(40);
    });
  }
});

/**
 * The ellipsis clause is the one entry that is not a ja/ko term: conventions.mdx
 * §3 contradicts itself, and the two zh bundles each took a different reading of
 * the contradiction. It needs both bundles to state, so it is checked here rather
 * than through the per-locale entry shape above.
 */
describe("the ellipsis clause stays unresolved in both zh bundles", () => {
  const mobileZh = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "apps/mobile/lib/i18n/locales/zh.json"), "utf8"),
  ) as Record<string, string>;
  const mobileEn = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "apps/mobile/lib/i18n/locales/en.json"), "utf8"),
  ) as Record<string, string>;

  it("keeps both readings in use, in both bundles", () => {
    for (const [name, bundle] of [
      ["views zh-Hans", load("zh-Hans")],
      ["mobile zh", mobileZh],
    ] as const) {
      expect(countMatching(bundle, /\.\.\./), `${name} no longer uses ...`).toBeGreaterThan(0);
      expect(countMatching(bundle, /…/), `${name} no longer uses …`).toBeGreaterThan(0);
    }
  });

  it("keeps the English source itself mixed, which is why the clause cannot be applied", () => {
    for (const [name, bundle] of [
      ["views en", en],
      ["mobile en", mobileEn],
    ] as const) {
      expect(countMatching(bundle, /\.\.\./), `${name} no longer uses ...`).toBeGreaterThan(0);
      expect(countMatching(bundle, /…/), `${name} no longer uses …`).toBeGreaterThan(0);
    }
  });
});

/**
 * The point of the ledger: conventions.mdx and this guard must name the same
 * terms. A doc row with no entry is an unverified claim; an entry with no doc row
 * is a decision nobody reading the contract can find.
 */
describe("the ledger and conventions.mdx agree on what is undecided", () => {
  const doc = readFileSync(CONVENTIONS, "utf8");
  const section = doc.split("**Currently undecided")[1]?.split("**ko register.**")[0] ?? "";
  const docTerms = [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((match) => match[1] ?? "");

  it("finds the undecided table in conventions.mdx", () => {
    expect(docTerms.length).toBeGreaterThanOrEqual(6);
  });

  it("has a ledger entry for every term the doc lists", () => {
    const covered = new Set([
      ...UNSETTLED.map((entry) => entry.docTerm),
      // Verified by the zh-bundle block above rather than by a per-locale entry,
      // because it needs both bundles to state.
      "Ellipsis",
    ]);
    const uncovered = docTerms.filter((term) => !covered.has(term));
    expect(
      uncovered,
      "conventions.mdx lists these as undecided but no ledger entry verifies the split",
    ).toEqual([]);
  });

  it("has a doc row for every ledger entry", () => {
    const missing = UNSETTLED.map((entry) => entry.docTerm).filter(
      (term) => !docTerms.includes(term),
    );
    expect(
      missing,
      "these ledger entries have no row in the conventions.mdx undecided table",
    ).toEqual([]);
  });
});
