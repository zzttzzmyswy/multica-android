import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  countMatching,
  load,
  loadMobile,
  measure,
  REPO_ROOT,
  type Bundle,
  type Fact,
  type Unit,
} from "./tally";

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
 * - `collision` — one or more pairs of anchors of the *same kind* that take
 *   *different* forms. That pair is the whole reason the bundle cannot settle the
 *   term: it rules out "a clear majority" (the minority is not a straggler, it is
 *   the same thing spelled another way) and it rules out "a clean partition" (the
 *   two forms share a surface). If a round makes the partition clean, the
 *   collision disappears and this test goes red — which is the signal to settle
 *   it.
 * - `unit` — whether the numbers in `why` count keys or occurrences. The 150
 *   round found the two calibers mixed silently across the table (the `Server`
 *   entry's "23 Latin" is a key count while the figure-spacing entry's "155 vs 40"
 *   is an occurrence count), which is exactly how a reader gets misled when a
 *   later round re-measures and gets a different number.
 * - `why` — the sentence conventions.mdx gives, so the code and the doc cannot
 *   drift apart. It must state its `unit`.
 * - `ask` — who has to answer, what exactly they must answer, and how much copy
 *   moves when they do. The 149 round recorded the *shape* of each disagreement
 *   but not what a decider is being asked; ten rounds of "still undecided" went by
 *   without anyone able to answer from the table alone. Each `ask` names either
 *   the locale owner (a word choice) or the typography owner (a spacing or style
 *   call) and carries the blast radius as a number.
 *
 * The last test in this file asserts the ledger and the doc list the same terms
 * and the same `ask` routing, in both directions. That is the "有据可依"
 * property: a reader who has only conventions.mdx and this guard can see every
 * open question, why it is open, exactly which keys hold it open, and who can
 * close it.
 */

const CONVENTIONS = resolve(REPO_ROOT, "apps/docs/content/docs/developers/conventions.mdx");

/**
 * The bundles a claim can be measured against. ja and ko come from the views
 * bundle like every other entry; the two zh bundles are here because the 152
 * round added a zh-side entry — the mobile app ships a flat zh/en pair outside
 * this directory, so it needs its own name rather than a directory.
 */
const BUNDLES = {
  en: load("en"),
  ja: load("ja"),
  ko: load("ko"),
  "zh-Hans": load("zh-Hans"),
  "zh-mobile": loadMobile("zh"),
  "en-mobile": loadMobile("en"),
};

const en = BUNDLES.en;
type Locale = "ja" | "ko" | "zh-Hans" | "zh-mobile";
const TARGETS: Record<Locale, Bundle> = {
  ja: BUNDLES.ja,
  ko: BUNDLES.ko,
  "zh-Hans": BUNDLES["zh-Hans"],
  "zh-mobile": BUNDLES["zh-mobile"],
};

/**
 * The English source an entry's `collision` anchors are checked against. The
 * mobile bundle is a different file with different keys, so an entry about it
 * cannot be checked against the views English.
 */
const enFor = (locale: Locale): Bundle =>
  locale === "zh-mobile" ? BUNDLES["en-mobile"] : BUNDLES.en;

/**
 * One number the `why` sentence states, written so the test below can re-derive
 * it from the bundle.
 *
 * The 151 round added this because the `collision` anchors and the unit prefix
 * between them still left the *numbers* unverified. They catch "an anchor was
 * rewritten" and "the sentence stopped saying what it counts"; they cannot catch
 * "the family grew a key" or "the sentence was measured over the wrong
 * surface". Both had happened:
 *
 *   - The `Server` rows read "native in all 15 of the 20 keys that name a
 *     server". 20 is the size of the `settings.mcp.*` surface, not the number of
 *     keys in it that name a server — that is 15, so the sentence claimed 20
 *     keys doing what 15 do. Same class of defect the 150 round fixed one entry
 *     over (a number borrowed from the wrong surface), found again.
 *   - The `Agent counter (ja)` row read "4 件 vs 2 個" and "ko is unanimous on
 *     개 for all six". Both numbers came from a position-scoped pattern
 *     (`エージェント {{n}} 件`), which sees 6 of the 18 keys that count an agent
 *     in ja. The other 12 take 件, 個 or a third counter, 体, in the
 *     placeholder-first position — so the entry understated its own surface
 *     threefold and missed a form entirely.
 *
 * A number in a `why` is now a claim the guard re-measures. `unit` defaults to
 * the entry's, and is overridden only where the sentence deliberately quotes a
 * second caliber.
 */
type Anchor = { key: string; contains: string };

/**
 * One number the `why` sentence states, written so the test below can re-derive
 * it from the bundle.
 *
 * The 151 round added this because the `collision` anchors and the unit prefix
 * between them still left the *numbers* unverified. They catch "an anchor was
 * rewritten" and "the sentence stopped saying what it counts"; they cannot catch
 * "the family grew a key" or "the sentence was measured over the wrong
 * surface". Both had happened:
 *
 *   - The `Server` rows read "native in all 15 of the 20 keys that name a
 *     server". 20 is the size of the `settings.mcp.*` surface, not the number of
 *     keys in it that name a server — that is 15, so the sentence claimed 20
 *     keys doing what 15 do. Same class of defect the 150 round fixed one entry
 *     over (a number borrowed from the wrong surface), found again.
 *   - The `Agent counter (ja)` row read "4 件 vs 2 個" and "ko is unanimous on
 *     개 for all six". Both numbers came from a position-scoped pattern
 *     (`エージェント {{n}} 件`), which sees 6 of the 18 keys that count an agent
 *     in ja. The other 12 take 件, 個 or a third counter, 体, in the
 *     placeholder-first position — so the entry understated its own surface
 *     threefold and missed a form entirely.
 *
 * A number in a `why` is a claim the guard re-measures. `unit` defaults to the
 * entry's, and is overridden only where the sentence deliberately quotes a
 * second caliber.
 *
 * The 152 round lifted the mechanism into `./tally.ts` so the guards that pin
 * conventions can state their tallies the same way — see that file for the two
 * free-text numbers it found already wrong. `Fact` is the shared `Measure` plus
 * the sentence's label; nothing about this file's claims changed.
 */
type Entry = {
  /** How conventions.mdx names this term in its undecided table. */
  docTerm: string;
  label: string;
  locale: Locale;
  forms: { label: string; pattern: RegExp }[];
  /** Same kind of string, two different forms — the partition is not clean. */
  collision: [Anchor, Anchor][];
  unit: Unit;
  why: string;
  ask: string;
  /** Every number `why` states, re-derived by the guard. */
  facts: Fact[];
};

const JA_COUNTERS = "秒|分|時間|日間|日中|日目|日|週間|週|か月|ヶ月|年|件|個|名|回|つ|人|本|枚|台|度|行|文字|ページ|階|時|泊|杯|冊";

/**
 * A counted agent in ja. The counter either follows the placeholder
 * (`エージェント {{count}} 件`) or precedes the noun (`{{count}} 件のエージェント`),
 * and both positions are the same question — the 150 round's pattern covered
 * only the first, which is how its tally came to read "4 件 vs 2 個 ... ko is
 * unanimous on 개 for all six" for a family that has 18 keys.
 */
const jaAgentCounter = (counter: string) =>
  new RegExp(
    `エージェント\\s*\\{\\{[^}]*\\}\\}\\s*(?:${counter})` +
      `|\\{\\{[^}]*\\}\\}\\s*(?:${counter})\\s*の\\s*エージェント`,
  );

const LATIN_ROLE = /(?<![A-Za-z])(owner|admin|member)s?(?![A-Za-z])/;

/**
 * Korean particles, copulas and verb endings, as a whole Hangul run. Matched
 * against the entire run rather than a prefix of it: `run.startsWith(particle)`
 * reads `AI 에이전트를` as the particle `에` on a noun `이전트를`, which is the
 * `표`/`표시` false positive in a different guise.
 *
 * The list is a closed class, and the 153 round measured the surface with it
 * rather than deriving a rule from it — see the `Particle spacing (ko)` entry.
 */
const KO_PARTICLES =
  "이|가|을|를|은|는|에|의|와|과|도|만|로|나|고|라|야|여|며|뿐|에서|으로|에게|부터|까지|" +
  "처럼|보다|마다|이나|이며|이고|이라|라는|이란|이든|에는|에도|에만|하면|입니다|뿐입니다|" +
  "뿐이며|으로는|에게는|에서도|으로도|에게도|이라고|이라는|으로써|으로서|에게서|부터는|" +
  "까지는|와는|과는|에서는";

/**
 * A token that contains at least one Latin letter. A bare figure is excluded on
 * purpose: `45초` and `7일` are the figure-to-counter surface the 150 round
 * pinned as tight, and a first version of this pattern counted them as Latin
 * words run into Korean ones.
 */
const KO_LATIN_TOKEN = "(?=[A-Za-z0-9.+#/_-]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9.+#/_-]*";

/** A particle attached to the Latin token before it. */
const KO_ATTACHED = new RegExp(`${KO_LATIN_TOKEN}(?:${KO_PARTICLES})(?![가-힣])`, "g");

/** The same particle, spaced off the Latin token. */
const KO_SPACED = new RegExp(`${KO_LATIN_TOKEN} (?:${KO_PARTICLES})(?![가-힣])`, "g");

/**
 * Who can close an entry. `ask` opens with one of these, and the doc row has to
 * route to the same one — that two-way check is what keeps the contract readable
 * on its own.
 */
const DECIDER = /(locale owner|typography owner)/i;
const deciderOf = (text: string) => text.match(DECIDER)?.[0].toLowerCase() ?? "";

const UNSETTLED: Entry[] = [
  {
    docTerm: "Server",
    label: "Server (ja)",
    locale: "ja",
    forms: [
      { label: "Latin Server", pattern: /(?<![A-Za-z])Servers?(?![A-Za-z])/ },
      { label: "サーバー", pattern: /サーバー/ },
    ],
    collision: [
      [
        { key: "agents.tab_body.mcp_config.dialog_name_required", contains: "Server" },
        { key: "agents.tab_body.mcp_config.dialog_name_locked", contains: "サーバー" },
      ],
    ],
    unit: "by key",
    why:
      "by key: 23 Latin vs 14 サーバー inside agents.tab_body.mcp_config.* alone (79 keys), " +
      "alternating key by key (dialog_name_required is Latin, dialog_name_locked is native), " +
      "while settings.mcp.* names a server in 15 of its 20 keys and is native in all 15",
    ask:
      "Locale owner: is an MCP server called `Server` or サーバー in ja? 23 Latin and 14 " +
      "native keys split the same surface, and the neighbouring settings.mcp.* surface is " +
      "native throughout, so whichever wins rewrites 37 ja keys.",
    facts: [
      {
        label: "keys in the mcp_config surface",
        scope: "agents.tab_body.mcp_config.",
        pattern: /[\s\S]/,
        expected: 79,
      },
      {
        label: "Latin Server in the mcp_config surface",
        scope: "agents.tab_body.mcp_config.",
        pattern: /(?<![A-Za-z])Servers?(?![A-Za-z])/,
        expected: 23,
      },
      {
        label: "サーバー in the mcp_config surface",
        scope: "agents.tab_body.mcp_config.",
        pattern: /サーバー/,
        expected: 14,
      },
      {
        label: "settings.mcp.* keys in total",
        scope: "settings.mcp.",
        pattern: /[\s\S]/,
        expected: 20,
      },
      {
        label: "settings.mcp.* keys that name a server",
        scope: "settings.mcp.",
        pattern: /(?<![A-Za-z])Servers?(?![A-Za-z])|サーバー/,
        expected: 15,
      },
      {
        label: "settings.mcp.* keys native",
        scope: "settings.mcp.",
        pattern: /サーバー/,
        expected: 15,
      },
    ],
  },
  {
    docTerm: "Server",
    label: "Server (ko)",
    locale: "ko",
    forms: [
      { label: "Latin Server", pattern: /(?<![A-Za-z])Servers?(?![A-Za-z])/ },
      { label: "서버", pattern: /서버/ },
    ],
    collision: [
      [
        { key: "agents.tab_body.mcp_config.dialog_name_required", contains: "Server" },
        { key: "agents.tab_body.mcp_config.dialog_name_locked", contains: "서버" },
      ],
    ],
    unit: "by key",
    why:
      "by key: identical to the ja side key for key — 23 Latin vs 14 서버 in " +
      "agents.tab_body.mcp_config.*, with the same two dialog_name_* keys disagreeing — and " +
      "settings.mcp.* names a server in 15 of its 20 keys, native in all 15",
    ask:
      "Locale owner: the same call for ko, where the split is identical (23 Latin vs 14 서버, " +
      "the same two dialog_name_* keys). Answer ja and ko in one decision and 74 keys move " +
      "together; answer ko alone and 37 ko keys move.",
    facts: [
      {
        label: "keys in the mcp_config surface",
        scope: "agents.tab_body.mcp_config.",
        pattern: /[\s\S]/,
        expected: 79,
      },
      {
        label: "Latin Server in the mcp_config surface",
        scope: "agents.tab_body.mcp_config.",
        pattern: /(?<![A-Za-z])Servers?(?![A-Za-z])/,
        expected: 23,
      },
      {
        label: "서버 in the mcp_config surface",
        scope: "agents.tab_body.mcp_config.",
        pattern: /서버/,
        expected: 14,
      },
      {
        label: "settings.mcp.* keys in total",
        scope: "settings.mcp.",
        pattern: /[\s\S]/,
        expected: 20,
      },
      {
        label: "settings.mcp.* keys that name a server",
        scope: "settings.mcp.",
        pattern: /(?<![A-Za-z])Servers?(?![A-Za-z])|서버/,
        expected: 15,
      },
      {
        label: "settings.mcp.* keys native",
        scope: "settings.mcp.",
        pattern: /서버/,
        expected: 15,
      },
    ],
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
      [
        { key: "issues.status.in_review", contains: "리뷰" },
        { key: "issues.detail.delegated_subscription_hint", contains: "검토" },
      ],
    ],
    unit: "by key",
    why:
      "by key: 9 검토 vs 8 리뷰, and the status control (issues.status.in_review) and the " +
      "prose that enumerates the same statuses disagree on the word",
    ask:
      "Locale owner: does the in-review state read 리뷰 or 검토? 9 검토 vs 8 리뷰 keys, and " +
      "because the status chip (issues.status.in_review) is one of the 리뷰 keys, the answer " +
      "is visible in the UI — 17 ko keys move.",
    facts: [
      { label: "검토 keys", pattern: /검토/, expected: 9 },
      { label: "리뷰 keys", pattern: /리뷰/, expected: 8 },
    ],
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
      [
        { key: "modals.create_issue.set_labels", contains: "레이블" },
        { key: "modals.create_issue.toast_link_labels_failed", contains: "라벨" },
      ],
    ],
    unit: "by key",
    why:
      "by key: 26 라벨 vs 25 레이블 with no partition — the same modal takes both " +
      "(modals.create_issue.set_labels is 레이블, its sibling toast is 라벨)",
    ask:
      "Locale owner: 라벨 or 레이블 for a label? 26 vs 25 keys with no partition at all — one " +
      "modal takes both — so no majority argument is available. 51 ko keys move.",
    facts: [
      { label: "라벨 keys", pattern: /라벨/, expected: 26 },
      { label: "레이블 keys", pattern: /레이블/, expected: 25 },
    ],
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
      [
        { key: "settings.mcp.admin_only_note", contains: "admin" },
        { key: "settings.members.roles.owner.label", contains: "オーナー" },
      ],
    ],
    unit: "by key",
    why:
      "by key: the section-2 rule keeps roles lowercase Latin and does not say whether it " +
      "binds ja; ja keeps Latin in 22 permission-prose keys against 130 native, overlapping " +
      "in 5, so the bundle does not answer which applies",
    ask:
      "Locale owner: does the section-2 'keep roles lowercase Latin' rule bind ja? ja keeps " +
      "Latin in 22 permission-prose keys but renders role labels natively in 130 (5 keys " +
      "carry both), so the call is a rule-scope decision, not a per-string one — up to 152 ja " +
      "keys move.",
    facts: [
      { label: "Latin role keys", pattern: LATIN_ROLE, expected: 22 },
      { label: "native role keys", pattern: /(メンバー|オーナー|管理者)/, expected: 130 },
      {
        label: "keys carrying both",
        pattern: LATIN_ROLE,
        also: /(メンバー|オーナー|管理者)/,
        expected: 5,
      },
    ],
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
      [
        { key: "settings.mcp.admin_only_note", contains: "owner" },
        { key: "settings.workspace.manage_hint", contains: "관리자" },
      ],
    ],
    unit: "by key",
    why:
      "by key: the same section-2 question on the ko side, where Latin survives in only 8 " +
      "keys against 141 native (1 key carries both), and the split runs through one surface: " +
      "settings.mcp.admin_only_note is Latin, settings.workspace.manage_hint is native",
    ask:
      "Locale owner: the same rule-scope call for ko, where the numbers are lopsided — Latin " +
      "in 8 keys against 141 native. A native-only answer touches 8 ko keys; a Latin-only " +
      "answer touches 141.",
    facts: [
      { label: "Latin role keys", pattern: LATIN_ROLE, expected: 8 },
      { label: "native role keys", pattern: /(멤버|소유자|관리자)/, expected: 141 },
      {
        label: "keys carrying both",
        pattern: LATIN_ROLE,
        also: /(멤버|소유자|관리자)/,
        expected: 1,
      },
    ],
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
      [
        { key: "common.lark_bind.error_expired", contains: "습니다" },
        { key: "common.slack_bind.error_expired", contains: "어요" },
      ],
    ],
    unit: "by key",
    why:
      "by key: 856 values carry 습니다 and 398 an 해요체 ending (895 and 439 by occurrence), " +
      "and the split cuts through one key family — common.lark_bind.error_expired and " +
      "common.slack_bind.error_expired are the same string in two registers",
    ask:
      "Locale owner: 습니다체 or 해요체 as the house register? 856 vs 398 keys, and the split " +
      "runs through every key family, so this is a whole-bundle decision covering 1254 ko " +
      "keys — the largest single answer on this list.",
    facts: [
      { label: "습니다 keys", pattern: /습니다/, expected: 856 },
      { label: "해요체 keys", pattern: /(어요|아요|세요|예요|이에요|해요)/, expected: 398 },
      { label: "습니다 occurrences", pattern: /습니다/g, unit: "by occurrence", expected: 895 },
      {
        label: "해요체 occurrences",
        pattern: /(어요|아요|세요|예요|이에요|해요)/g,
        unit: "by occurrence",
        expected: 439,
      },
    ],
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
      [
        { key: "settings.plugins.private", contains: "プライベート" },
        { key: "settings.repositories.github_private", contains: "非公開" },
      ],
    ],
    unit: "by key",
    why:
      "by key: 7 プライベート vs 9 非公開, and the two forms are not split by surface or by " +
      "label-vs-prose: settings.plugins.private and settings.repositories.github_private " +
      "are both a bare `Private` label under settings and take different words",
    ask:
      "Locale owner: プライベート or 非公開 for a bare `Private` label? 7 vs 9 keys, split by " +
      "neither surface nor label-vs-prose, so no partition argument is available. 16 ja keys " +
      "move.",
    facts: [
      { label: "プライベート keys", pattern: /プライベート/, expected: 7 },
      { label: "非公開 keys", pattern: /非公開/, expected: 9 },
    ],
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
      [
        { key: "autopilots.relative_date.one_day_ago", contains: "1 日" },
        { key: "projects.relative_date.one_day_ago", contains: "1日" },
      ],
      [
        { key: "autopilots.relative_date.months_ago", contains: "}} か月" },
        { key: "projects.relative_date.months_ago", contains: "}}か月" },
      ],
    ],
    unit: "by occurrence",
    why:
      "by occurrence: 42 spaced vs 14 tight on a literal figure, and 155 spaced vs 40 tight " +
      "on a placeholder (both counts over every placeholder name), and the same English " +
      "source renders both ways — autopilots.relative_date.one_day_ago is `1 日前` while " +
      "projects.relative_date.one_day_ago is `1日前`, both from `1d ago`",
    ask:
      "Typography owner: is a figure separated from its counter by a space? 42 vs 14 literal " +
      "occurrences and 155 vs 40 on placeholders, so 211 occurrences move. This is a spacing " +
      "call rather than a word choice, which is why it does not route to a locale owner — and " +
      "the round-150 note below records that the external standards checked do not answer it.",
    facts: [
      {
        label: "spaced literal occurrences",
        pattern: new RegExp(`\\d\\s+(?:${JA_COUNTERS})`, "g"),
        expected: 42,
      },
      {
        label: "tight literal occurrences",
        pattern: new RegExp(`\\d(?:${JA_COUNTERS})`, "g"),
        expected: 14,
      },
      {
        label: "spaced placeholder occurrences",
        pattern: new RegExp(`\\}\\}\\s+(?:${JA_COUNTERS})`, "g"),
        expected: 155,
      },
      {
        label: "tight placeholder occurrences",
        pattern: new RegExp(`\\}\\}(?:${JA_COUNTERS})`, "g"),
        expected: 40,
      },
    ],
  },
  {
    docTerm: "Agent counter (ja)",
    label: "agent counter (ja)",
    locale: "ja",
    forms: [
      { label: "件", pattern: jaAgentCounter("件") },
      { label: "個", pattern: jaAgentCounter("個") },
      { label: "体", pattern: jaAgentCounter("体") },
    ],
    collision: [
      [
        { key: "agents.runtime_filter.agent_count_other", contains: "件" },
        { key: "runtimes.detail.serving_count_other", contains: "個" },
      ],
      [
        { key: "usage.leaderboard.caption", contains: "件" },
        { key: "skills.detail.header.used_by_other", contains: "個" },
      ],
    ],
    unit: "by key",
    why:
      "by key: 9 件 vs 5 個 vs 4 体 over the 18 ja keys that count an agent, and the split is " +
      "not source-side — the identical English source `{{count}} agents` takes 件 in two keys " +
      "(agents.runtime_filter.agent_count_other, usage.leaderboard.caption) and 個 in two " +
      "others (runtimes.detail.serving_count_other, skills.detail.header.used_by_other), a " +
      "2:2 tie on one source — while ko is unanimous on 개 for all 18, so this is ja-only",
    ask:
      "Locale owner: is a counted agent 件, 個 or 体? 9 vs 5 vs 4 keys with no majority at " +
      "all, the identical English source `{{count}} agents` splitting 2:2 between 件 and 個, " +
      "and a third counter (体) confined to the unbind and trigger sentences — ko is " +
      "unanimous (개) on all 18, so the answer is ja-only and 18 ja keys move.",
    facts: [
      { label: "件 keys", pattern: jaAgentCounter("件"), expected: 9 },
      { label: "個 keys", pattern: jaAgentCounter("個"), expected: 5 },
      { label: "体 keys", pattern: jaAgentCounter("体"), expected: 4 },
      {
        label: "keys whose source is exactly `{{count}} agents`",
        keys: [
          "agents.runtime_filter.agent_count_other",
          "runtimes.detail.serving_count_other",
          "skills.detail.header.used_by_other",
          "usage.leaderboard.caption",
        ],
        pattern: jaAgentCounter("件|個|体"),
        expected: 4,
      },
      {
        label: "of those, the 件 half of the 2:2 tie",
        keys: [
          "agents.runtime_filter.agent_count_other",
          "runtimes.detail.serving_count_other",
          "skills.detail.header.used_by_other",
          "usage.leaderboard.caption",
        ],
        pattern: jaAgentCounter("件"),
        expected: 2,
      },
      {
        label: "ko keys taking 개 for the same 18-key family",
        keysFrom: { locale: "ja", pattern: jaAgentCounter("件|個|体") },
        pattern: /개/,
        locale: "ko",
        expected: 18,
      },
      {
        label: "ko keys taking a rival counter",
        keysFrom: { locale: "ja", pattern: jaAgentCounter("件|個|体") },
        pattern: /(건|가지|명)/,
        locale: "ko",
        expected: 0,
      },
    ],
  },
  {
    docTerm: "Tool counter (ja)",
    label: "tool counter (ja)",
    locale: "ja",
    forms: [
      { label: "件", pattern: new RegExp(`ツール\\s*\\{\\{[^}]*\\}\\}\\s*件`) },
      { label: "個", pattern: new RegExp(`ツール\\s*\\{\\{[^}]*\\}\\}\\s*個`) },
    ],
    collision: [
      [
        { key: "issues.agent_live.tool_count_other", contains: "件" },
        { key: "chat.message_list.tools_other", contains: "個" },
      ],
    ],
    unit: "by key",
    why:
      "by key: 1 件 vs 1 個 with no majority at all, the same English source " +
      "(`{{count}} tools`) on both, and ko unanimous (개) — the tight-spacing member of this " +
      "pair is also one of the figure-spacing outliers above",
    ask:
      "Locale owner: is a counted tool 件 or 個? 1 vs 1 key, so there is not even a majority " +
      "to lean on, and one of the two is the tight-spacing outlier in the figure-spacing " +
      "entry above — 2 ja keys move.",
    facts: [
      { label: "ツール 件 keys", pattern: new RegExp(`ツール\\s*\\{\\{[^}]*\\}\\}\\s*件`), expected: 1 },
      { label: "ツール 個 keys", pattern: new RegExp(`ツール\\s*\\{\\{[^}]*\\}\\}\\s*個`), expected: 1 },
      {
        label: "ko 도구 개 keys",
        pattern: new RegExp(`도구\\s*\\{\\{[^}]*\\}\\}\\s*개`),
        locale: "ko",
        expected: 2,
      },
    ],
  },
  {
    docTerm: "ブラウザ",
    label: "browser notation (ja)",
    locale: "ja",
    forms: [
      { label: "ブラウザ", pattern: /ブラウザ(?!ー)/ },
      { label: "ブラウザー", pattern: /ブラウザー/ },
    ],
    collision: [
      [
        { key: "settings.shortcuts.reserved_error", contains: "ブラウザ" },
        { key: "settings.shortcuts.actions.goBack.description", contains: "ブラウザー" },
      ],
    ],
    unit: "by key",
    why:
      "by key: 11 ブラウザ vs 2 ブラウザー, and unlike the other katakana splits this round " +
      "measured, the minority sits inside the majority's own namespace — " +
      "settings.shortcuts.reserved_error writes ブラウザ while its two siblings " +
      "settings.shortcuts.actions.goBack.description and goForward.description write " +
      "ブラウザー, so the same surface and the same kind of string take both forms",
    ask:
      "Locale owner: is a browser ブラウザ or ブラウザー? 11 vs 2 keys, with the two long-form " +
      "keys sitting beside a short-form sibling in settings.shortcuts.* — so no majority " +
      "argument and no partition argument is available, and 13 ja keys move either way.",
    facts: [
      { label: "ブラウザ keys", pattern: /ブラウザ(?!ー)/, expected: 11 },
      { label: "ブラウザー keys", pattern: /ブラウザー/, expected: 2 },
      {
        label: "ブラウザ occurrences",
        pattern: /ブラウザ(?!ー)/g,
        unit: "by occurrence",
        expected: 12,
      },
      {
        label: "ブラウザー occurrences",
        pattern: /ブラウザー/g,
        unit: "by occurrence",
        expected: 2,
      },
    ],
  },
  {
    docTerm: "Dash (zh)",
    label: "dash (views zh-Hans)",
    locale: "zh-Hans",
    forms: [
      { label: "—— doubled", pattern: /——/ },
      { label: " — spaced single", pattern: / — / },
    ],
    collision: [
      [
        { key: "issues.gantt.empty", contains: " — " },
        { key: "issues.execution_log.retry_blocked", contains: "——" },
      ],
    ],
    unit: "by key",
    why:
      "by key: 95 keys write the doubled —— and 3 keep the English ` — `, and the split is " +
      "not by surface or by sentence shape — issues.gantt.empty and " +
      "issues.execution_log.retry_blocked are both an issues sentence that states a condition " +
      "and then a hint, and they take different dashes",
    ask:
      "Typography owner: is a Chinese prose dash —— or the English ` — `? 95 keys against 3, " +
      "with both forms inside the same namespace, so no majority-with-debt argument and no " +
      "partition argument is available. 98 views zh-Hans keys move.",
    facts: [
      { label: "—— keys", pattern: /——/, expected: 95 },
      { label: "` — ` keys", pattern: / — /, expected: 3 },
    ],
  },
  {
    docTerm: "Dash (zh)",
    label: "dash (mobile zh)",
    locale: "zh-mobile",
    forms: [
      { label: "—— doubled", pattern: /——/ },
      { label: " — spaced single", pattern: / — / },
    ],
    collision: [
      [
        { key: "issues.gantt.empty", contains: " — " },
        { key: "issueViews.noViews", contains: "——" },
      ],
    ],
    unit: "by key",
    why:
      "by key: the same question in the mobile bundle, where the split is wider — 39 keys " +
      "write —— and 8 keep ` — ` — and the two empty states of the issues surface disagree: " +
      "issues.gantt.empty keeps the English dash while issueViews.noViews takes the doubled one",
    ask:
      "Typography owner: the same call for the mobile bundle, where the minority is 8 of 47 " +
      "keys rather than 3 of 98, and two empty states on one surface disagree. Answer both " +
      "bundles together and 145 zh keys move.",
    facts: [
      { label: "—— keys", pattern: /——/, expected: 39 },
      { label: "` — ` keys", pattern: / — /, expected: 8 },
    ],
  },
  {
    docTerm: "Particle spacing (ko)",
    label: "particle spacing after Latin (ko)",
    locale: "ko",
    forms: [
      { label: "attached", pattern: KO_ATTACHED },
      { label: "spaced", pattern: KO_SPACED },
    ],
    collision: [
      [
        { key: "skills.detail.add_file.errors.reserved", contains: "SKILL.md는" },
        { key: "settings.lark.page_description", contains: "/issue 를" },
      ],
    ],
    unit: "by occurrence",
    why:
      "by occurrence: a Korean particle attaches directly to a Latin token 316 times against 3 " +
      "that are spaced, but the minority sits inside the majority's own surface — settings.* " +
      "holds 109 attached and all 3 spaced — and the partition a reader reaches for is refuted: " +
      "a Latin literal the user types takes the particle attached ten times (SKILL.md는, " +
      "Skills.sh에서, GITHUB_APP_ID와, Shift+Enter로, features/의) and spaced three (multica " +
      "login --token 으로, /issue 를 twice), so neither word-against-literal nor surface " +
      "separates the two forms",
    ask:
      "Typography owner: does a Korean particle attach to a Latin token, or is it spaced after " +
      "one? 315 occurrences attach and 3 are spaced, all three inside settings.*, so neither a " +
      "majority argument nor a partition argument is available, and 3 ko keys move either way.",
    facts: [
      { label: "attached occurrences", pattern: KO_ATTACHED, expected: 316 },
      { label: "spaced occurrences", pattern: KO_SPACED, expected: 3 },
      { label: "attached keys", pattern: KO_ATTACHED, unit: "by key", expected: 260 },
      { label: "spaced keys", pattern: KO_SPACED, unit: "by key", expected: 3 },
      {
        label: "attached occurrences inside settings.*",
        pattern: KO_ATTACHED,
        scope: "settings.",
        expected: 109,
      },
    ],
  },
  {
    docTerm: "list (ko)",
    label: "list (ko)",
    locale: "ko",
    forms: [
      { label: "목록", pattern: /목록/ },
      { label: "리스트", pattern: /(?<![가-힣])리스트/ },
    ],
    collision: [
      [
        { key: "editor.bubble_menu.list", contains: "목록" },
        { key: "issues.view.list", contains: "리스트" },
      ],
    ],
    unit: "by key",
    why:
      "by key: 목록 20 vs 리스트 4, and the split is not by sense — the same English source " +
      "`List` is 목록 in editor.bubble_menu.list and 리스트 in issues.view.list, both a bare " +
      "one-word label",
    ask:
      "Locale owner: is a list 목록 or 리스트? 20 vs 4 keys, with the minority naming the issue " +
      "and my-issues list views while the majority is the common noun — that surface argument is " +
      "available but unverified, so 24 ko keys move either way.",
    facts: [
      { label: "목록 keys", pattern: /목록/, expected: 20 },
      { label: "리스트 keys", pattern: /(?<![가-힣])리스트/, expected: 4 },
    ],
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
      const english = enFor(entry.locale);
      for (const [a, b] of entry.collision) {
        for (const anchor of [a, b]) {
          expect(english[anchor.key], `${anchor.key} must be real product copy`).toBeDefined();
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
      }
    });

    it(`records why ${entry.label} cannot be settled from the bundle`, () => {
      expect(entry.why.length).toBeGreaterThan(40);
    });

    /**
     * The 150 round's addition. A `why` whose numbers do not say what they count
     * is how the Server entry came to read "23 Latin vs 15 サーバー" for a surface
     * whose native count is 14 — 15 was settings.mcp.*'s number, borrowed into the
     * wrong sentence. Requiring the unit in the sentence is cheap and makes the
     * next re-measurement comparable instead of contradictory.
     */
    it(`states the count caliber in ${entry.label}'s why`, () => {
      expect(
        entry.why.startsWith(`${entry.unit}:`),
        `${entry.label}'s why must open with its unit ("${entry.unit}:") so a later round ` +
          `re-measuring gets a comparable number; got ${JSON.stringify(entry.why.slice(0, 60))}`,
      ).toBe(true);
    });

    /**
     * The 150 addition: an entry has to say who can close it and what
     * answering costs. Ten rounds recorded "still undecided" without the table
     * ever being answerable on its own.
     */
    it(`routes ${entry.label} to a decider with a blast radius`, () => {
      expect(
        deciderOf(entry.ask),
        `${entry.label}'s ask must open with the decider (locale owner or typography owner), ` +
          `got ${JSON.stringify(entry.ask.slice(0, 60))}`,
      ).not.toBe("");
      expect(
        entry.ask.length,
        `${entry.label}'s ask is too short to say what is being asked`,
      ).toBeGreaterThan(60);
      expect(
        /\d/.test(entry.ask),
        `${entry.label}'s ask must carry the blast radius as a number`,
      ).toBe(true);
    });

    /**
     * The 151 addition. The `collision` anchors catch "an anchor was rewritten"
     * and the unit prefix catches "the sentence stopped saying what it counts";
     * neither catches "the family grew a key" or "the number was measured over
     * the wrong surface". Both had happened — see the `Fact` doc comment above
     * for the two entries it was found in.
     *
     * Re-deriving every number from the bundle makes the `why` a claim instead
     * of a note, and it is what turns the ledger from a record into a detector:
     * a round that adds a key to any of these families goes red here and has to
     * re-measure and re-ask, rather than leaving a stale number to be trusted.
     */
    it(`keeps every number in ${entry.label}'s why re-derivable`, () => {
      expect(
        entry.facts.length,
        `${entry.label} states numbers but records no facts to re-derive them`,
      ).toBeGreaterThan(0);
      for (const fact of entry.facts) {
        const measured = measure(fact, {
          locale: fact.locale ?? entry.locale,
          unit: fact.unit ?? entry.unit,
          bundles: BUNDLES,
          mask: (value) => value ?? "",
        });
        expect(
          measured,
          `${entry.label} / ${fact.label}: the why states ${fact.expected}, the bundle has ` +
            `${measured} — re-measure and update the sentence (and the doc row) together`,
        ).toBe(fact.expected);
      }
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
  const mobileZh = loadMobile("zh");
  const mobileEn = loadMobile("en");

  it("keeps both readings in use, in both bundles", () => {
    for (const [name, bundle] of [
      ["views zh-Hans", BUNDLES["zh-Hans"]],
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
 * The 150 round closed one open route rather than leaving it to be re-walked.
 * The 149 round flagged the ja figure-spacing split as a candidate for settling
 * from an external standard. Both standards that could plausibly speak to it were
 * read, and neither does — so the negative result is recorded here. A future round
 * that wants to re-open the route can see it was already walked and what it found.
 *
 * This test asserts only that the note is present and names both sources; it
 * cannot assert what they say, because that is the point — they say nothing about
 * the question.
 */
describe("the external-standard route for ja figure spacing is recorded as closed", () => {
  const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const note = source.split("EXTERNAL_STANDARD_NOTE")[1] ?? "";

  it("names both standards that were read", () => {
    expect(note).toContain("公用文作成の要領");
    expect(note).toContain("JLReq");
  });

  it("records that neither states a figure-to-counter spacing rule", () => {
    expect(note).toMatch(/silent|does not state|no rule/i);
  });
});

/**
 * EXTERNAL_STANDARD_NOTE — round 150, item 2.
 *
 * The question: can an external standard settle whether ja puts a space between a
 * figure and its counter, instead of leaving it to the locale owner?
 *
 * Two sources were read, being the two that could plausibly speak to it.
 *
 * 1. 文化庁「新しい「公用文作成の要領」に向けて（報告）」(2021), Ⅰ-4「数字の使い方」.
 *    This is the operative Japanese government writing standard. **The word 助数詞
 *    does not appear anywhere in the report.** Its numeral section governs 算用数字
 *    vs 漢数字, 全角 vs 半角 (explicitly "特に定めはない" — no rule, just be
 *    consistent within a document), three-digit comma grouping, 兆・億・万 in kanji,
 *    and counter *spelling* (「○か所」「○か月」 in hiragana, explicitly rejecting
 *    「３ヶ所」「７カ月」). It states no spacing rule. Its own model examples (「３か所」
 *    「７か月」) use a full-width digit, which is the report's own convention for
 *    single digits — so there is no Japanese/Latin boundary inside them and the
 *    question does not arise. The standard is **silent**, not in conflict.
 *
 * 2. W3C JLReq (Requirements for Japanese Text Layout, the public form of the
 *    JIS X 4051 line of work). **助数詞 does not appear**; 算用数字 appears once, in
 *    the glossary ("European numerals / アラビア数字"). Its spacing rules — 二分アキ,
 *    四分アキ, ベタ組 — are defined **only for punctuation classes** (始め括弧類,
 *    終わり括弧類, 読点類, 句点類, 中点類). Nothing defines a figure-to-counter gap.
 *    Again **silent**.
 *
 * Conclusion: the external-standard route **cannot** settle this. A standard that
 * does not address the question can neither confirm the 42-vs-14 majority nor
 * override it, and using it as if it did would be inventing a rule and attributing
 * it to the standard. The entry stays open and stays routed to the typography
 * owner. What the round *did* settle from source 1 is adjacent: the counter
 * spelling the bundle already uses (か月, not ヶ月) is the one that standard
 * prescribes — verified separately, 2 keys, 0 exceptions.
 */

/**
 * The point of the ledger: conventions.mdx and this guard must name the same
 * terms, and route each to the same decider. A doc row with no entry is an
 * unverified claim; an entry with no doc row is a decision nobody reading the
 * contract can find.
 */
describe("the ledger and conventions.mdx agree on what is undecided", () => {
  const doc = readFileSync(CONVENTIONS, "utf8");
  const section = doc.split("**Currently undecided")[1]?.split("**ko register.**")[0] ?? "";
  const rows = [...section.matchAll(/^\|\s*`([^`]+)`\s*\|([^|]*)\|([^|]*)\|([^|]*)\|/gm)].map(
    (match) => ({
      term: match[1] ?? "",
      ask: (match[4] ?? "").trim(),
    }),
  );
  const docTerms = rows.map((row) => row.term);
  const askByTerm = new Map(rows.map((row) => [row.term, row.ask]));

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

  /**
   * The `ask` half of the two-way property. The doc row has to carry the same
   * routing as the entry, or a reader of the contract alone cannot tell who to
   * ask — which is the state the table was in for rounds 140 through 149.
   */
  it("routes every doc row to the same decider the ledger names", () => {
    for (const entry of UNSETTLED) {
      const cell = askByTerm.get(entry.docTerm) ?? "";
      expect(cell, `${entry.docTerm} has no Ask cell in the conventions.mdx table`).not.toBe("");
      const decider = deciderOf(entry.ask);
      expect(
        cell.toLowerCase(),
        `${entry.docTerm}'s doc row must route to the same decider (${decider}) as its ` +
          `ledger entry, got ${JSON.stringify(cell)}`,
      ).toContain(decider);
    }
  });

  it("keeps every doc row's Ask cell non-empty, including the ellipsis row", () => {
    const empty = rows.filter((row) => row.ask === "").map((row) => row.term);
    expect(empty, "these doc rows have no Ask cell, so the table cannot be acted on").toEqual([]);
  });
});
