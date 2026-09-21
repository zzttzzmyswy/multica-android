import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard for the two zh bundles agreeing with each other on the chat surface.
 *
 * apps/mobile/lib/i18n and packages/views/locales are independent bundles —
 * mobile loads only its own single-file zh.json, views its per-namespace
 * files — so nothing forced the same English string to come out the same way
 * in both. The 145 round's chat-track scan compared them by source string and
 * found eight chat strings that had drifted apart; six were collapsed (the
 * `{{elapsed}}` captions, the empty-state card's pronouns, `No text reply`,
 * and a path segment padded with spaces) and four have no rule that decides
 * between the two readings.
 *
 * Those four are pinned below rather than silently tolerated: each carries the
 * reason it is still a fork, so a later round has to argue with the reason
 * instead of re-discovering the fork. Anything *not* on the list fails here,
 * which is what stops the next translation pass from drifting the two bundles
 * apart again.
 *
 * The second suite covers a defect the same scan walked into: one mobile
 * string used both 您 and 你 in a single sentence.
 */

const MOBILE_LOCALES_DIR = path.resolve(__dirname, "locales");
const VIEWS_LOCALES_DIR = path.resolve(__dirname, "../../../../packages/views/locales");

type Bundle = Record<string, string>;

function flatten(value: unknown, prefix = ""): Bundle {
  if (value === null || typeof value !== "object") return { [prefix]: String(value) };
  return Object.entries(value as Record<string, unknown>).reduce<Bundle>(
    (acc, [key, child]) => Object.assign(acc, flatten(child, prefix ? `${prefix}.${key}` : key)),
    {},
  );
}

function readFlat(file: string): Bundle {
  return flatten(JSON.parse(readFileSync(file, "utf8")));
}

/** The views chat namespace, keyed the way the mobile bundle keys its chat. */
function readViewsChat(locale: string): Bundle {
  const flat = readFlat(path.join(VIEWS_LOCALES_DIR, locale, "chat.json"));
  return Object.fromEntries(Object.entries(flat).map(([key, value]) => [`chat.${key}`, value]));
}

const mobileEn = readFlat(path.join(MOBILE_LOCALES_DIR, "en.json"));
const mobileZh = readFlat(path.join(MOBILE_LOCALES_DIR, "zh.json"));
const viewsEn = readViewsChat("en");
const viewsZh = readViewsChat("zh-Hans");

/**
 * The chat surface on each side: mobile keeps it in `chat.*` (plus the a11y
 * label for the chat page's new-chat button), views in its `chat` namespace.
 */
const mobileChatKeys = Object.keys(mobileEn).filter(
  (key) => key.startsWith("chat.") || key === "a11y.newChat",
);
const viewsChatKeys = Object.keys(viewsEn);

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

/**
 * The English source, normalized so that cosmetic differences between the two
 * bundles do not read as translation forks: the views empty state prefixes a
 * ✨ the mobile one omits, and the bundles disagree about `…` / `...` and
 * `—` / `-` (see the ellipsis clause in conventions.mdx, still undecided).
 * Interpolation bindings are collapsed to `{{name}}` so `{{ count }}` and
 * `{{count}}` compare equal.
 */
function sourceKey(value: string): string {
  return value
    .replace(EMOJI, "")
    .replace(/\{\{\s*(\w+)\s*\}\}/g, "{{$1}}")
    .replace(/[‘’]/g, "'")
    .replace(/—/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The zh side of the same comparison: decoration the two bundles are free to
 * differ on (the views empty state keeps the ✨ its English source carries)
 * must not read as a fork either.
 */
function valueKey(value: string): string {
  return value.replace(EMOJI, "").replace(/\s+/g, " ").trim();
}

function bySource(keys: string[], source: Bundle, target: Bundle) {
  const grouped = new Map<string, { keys: string[]; zh: Set<string> }>();
  for (const key of keys) {
    const en = source[key];
    const zh = target[key];
    if (en === undefined || zh === undefined) continue;
    const bucket = grouped.get(sourceKey(en)) ?? { keys: [], zh: new Set<string>() };
    bucket.keys.push(key);
    bucket.zh.add(valueKey(zh));
    grouped.set(sourceKey(en), bucket);
  }
  return grouped;
}

const mobileBySource = bySource(mobileChatKeys, mobileEn, mobileZh);
const viewsBySource = bySource(viewsChatKeys, viewsEn, viewsZh);

/**
 * Chat strings both bundles translate whose zh still differs, with the reason
 * the 145 round left each one alone. Every entry is a *decision*: none of the
 * four has a glossary rule or a majority in either bundle to break the tie,
 * and picking a side by preference is exactly what the round's discipline
 * forbids. Collapsing one is a docs decision, not a translation one.
 */
const DOCUMENTED_FORKS: { source: string; mobile: string; views: string; why: string }[] = [
  {
    source: "New chat",
    mobile: "新聊天",
    views: "新对话",
    why: "different surfaces — mobile's is the chat page's new-chat a11y label, views' the floating window tooltip — and each bundle renders its own surface consistently",
  },
  {
    source: "No messages yet",
    mobile: "暂无消息",
    views: "还没有消息",
    why: "no rule picks between 暂无 and 还没有; both bundles use both forms elsewhere in the chat surface",
  },
  {
    source: "Summarize what I did today",
    mobile: "总结我今天做了什么",
    views: "总结一下我今天做了什么",
    why: "no rule decides whether a starter prompt carries the 一下 softener",
  },
  {
    source: "Try asking",
    mobile: "试试这样提问",
    views: "试试问",
    why: "no rule decides the register of the returning-user heading",
  },
];

const forkBySource = new Map(DOCUMENTED_FORKS.map((fork) => [fork.source, fork]));

describe("zh bundles agree on the chat surface", () => {
  it("renders every shared chat string the same way on both sides", () => {
    const offenders: string[] = [];
    for (const [source, mobile] of mobileBySource) {
      const views = viewsBySource.get(source);
      if (!views || forkBySource.has(source)) continue;
      if (mobile.zh.size !== 1 || views.zh.size !== 1) continue;
      const [mobileZhValue] = [...mobile.zh];
      const [viewsZhValue] = [...views.zh];
      if (mobileZhValue !== viewsZhValue) {
        offenders.push(
          `${JSON.stringify(source)}: mobile ${mobile.keys.join(", ")} -> ${JSON.stringify(mobileZhValue)}, ` +
            `views ${views.keys.join(", ")} -> ${JSON.stringify(viewsZhValue)}`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps each documented fork at the wording both sides settled on", () => {
    const offenders: string[] = [];
    for (const fork of DOCUMENTED_FORKS) {
      const mobile = mobileBySource.get(fork.source);
      const views = viewsBySource.get(fork.source);
      if (!mobile || !views) {
        offenders.push(`${fork.source}: no longer a shared source string — drop it from the table`);
        continue;
      }
      if (!mobile.zh.has(fork.mobile)) {
        offenders.push(`${fork.source}: mobile is no longer ${JSON.stringify(fork.mobile)}`);
      }
      if (!views.zh.has(fork.views)) {
        offenders.push(`${fork.source}: views is no longer ${JSON.stringify(fork.views)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the comparison set at the size the chat scan measured", () => {
    // The two surfaces cover different ground, so most keys are one-sided and
    // there is nothing to compare. The count of shared source strings is what
    // this guard actually reaches; pinning it means a wholesale rename on one
    // side cannot quietly empty the suites above into a green no-op.
    //
    // 37 = 35 at the original scan + the archived-agent pair added in
    // iteration 161 (`chat.agentArchived` / `chat.archivedAgentBanner`, both
    // verbatim from views' `input.placeholder_archived_agent` and
    // `archived_agent_banner`), which the suite above now holds to agreement.
    //
    // +9 in iteration 172: the chat-window parity batch — `loadingOlder`,
    // `olderLoadFailed`, `quickActionsHeading`, `regenerateQuickActions`,
    // `regenerateQuickActionsFailed`, `stop`, `stopDialogTitle`,
    // `stopDialogCancel` and `stopDialogConfirm` — all copied from views'
    // `message_list.*` / `session_history.*`, so they join the comparison set
    // and the suite above now pins their zh wording against web's.
    //
    // +12 in iteration 173: the onboarding starter cards — `ariaLabel`, `cta`,
    // the three `{title, desc, prompt}` triples and `digestBadge` — copied
    // verbatim from views' `onboarding_cards.*` so a new member reads the same
    // three ways to start on either client.
    const shared = [...mobileBySource.keys()].filter((source) => viewsBySource.has(source));
    expect(shared.length).toBe(58);
  });
});

const POLITE = "您";
const PLAIN = "你";

/** Every views namespace, so the register rule covers the whole bundle. */
function readAllViews(locale: string): Bundle {
  return readdirSync(path.join(VIEWS_LOCALES_DIR, locale))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reduce<Bundle>((acc, name) => {
      const ns = name.replace(/\.json$/, "");
      for (const [key, value] of Object.entries(readFlat(path.join(VIEWS_LOCALES_DIR, locale, name)))) {
        acc[`${ns}.${key}`] = value;
      }
      return acc;
    }, {});
}

const viewsZhAll = readAllViews("zh-Hans");

describe("zh bundles never mix 您 and 你 inside one string", () => {
  const bundles: [string, Bundle][] = [
    ["mobile", mobileZh],
    ["views", viewsZhAll],
  ];

  it("keeps a single address register per string", () => {
    const offenders: string[] = [];
    for (const [name, bundle] of bundles) {
      for (const [key, value] of Object.entries(bundle)) {
        if (value.includes(POLITE) && value.includes(PLAIN)) {
          offenders.push(`${name} ${key}: ${JSON.stringify(value)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("pins the chat empty-state card to the plain register", () => {
    // The card renders title, intro, pillars, suffix and line as one block, so
    // a polite 您 in any part of it contradicts the 你 next to it.
    const card = [
      "chat.emptyFirstTitle",
      "chat.emptyFirstIntro",
      "chat.emptyFirstStrong",
      "chat.emptyFirstOutro",
      "chat.emptyFirstLine",
    ];
    const offenders = card
      .filter((key) => (mobileZh[key] ?? "").includes(POLITE))
      .map((key) => `mobile ${key}: ${JSON.stringify(mobileZh[key])}`);
    expect(offenders).toEqual([]);
  });
});
