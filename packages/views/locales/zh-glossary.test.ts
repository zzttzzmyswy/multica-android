import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guard for the "Translate fully — concepts" column of the Chinese voice guide
 * (apps/docs/content/docs/developers/conventions.mdx, section 2) across the
 * packages/views zh-Hans bundle — the copy apps/web and apps/desktop render.
 *
 * This bundle is consumed by two apps, so the 139/140 rounds deliberately left
 * it alone while they migrated the mobile bundle (apps/mobile/lib/i18n). The
 * mobile guard (apps/mobile/lib/i18n/zh-glossary.test.ts) could lean on a
 * hand-kept list of ~60 keys; at this bundle's size that does not scale, so the
 * rule here is derived instead:
 *
 *   1. Strip the two kinds of thing that are never prose — `{{binding}}`
 *      placeholders and `` `code spans` ``.
 *   2. Mask the documented code references (below), which survive on purpose.
 *   3. Whatever concept token is left is a leak.
 *
 * The exception table is closed and each entry carries its reason, so a new
 * English word fails this suite until someone classifies it. That is the point:
 * the 139 round's bare Latin-character scan produced a heuristic (76 candidate
 * strings, 9 "probably fine"), and a heuristic nobody re-derives rots.
 *
 * `task` (one agent execution run) is deliberately absent — it stays lowercase
 * English per the glossary — as are the role/status enums, which stay lowercase
 * English too.
 */

const LOCALES_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_LOCALE = "en";
const TARGET_LOCALE = "zh-Hans";

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

/** `namespace.key.path` -> string, for every namespace in the bundle. */
function load(locale: string): Bundle {
  return namespaces(locale).reduce<Bundle>((acc, ns) => {
    const raw = readFileSync(resolve(LOCALES_DIR, locale, `${ns}.json`), "utf8");
    const flat = flatten(JSON.parse(raw));
    for (const [key, value] of Object.entries(flat)) acc[`${ns}.${key}`] = value;
    return acc;
  }, {});
}

const en = load(SOURCE_LOCALE);
const zh = load(TARGET_LOCALE);
const keys = Object.keys(zh).sort();

// The reads below spell out `?? ""` because `noUncheckedIndexedAccess` cannot
// see that a `Record<string, string>` lookup is total here: every key comes
// from `keys`, which is `Object.keys(zh)` itself, and `parity.test.ts` pins zh
// against en — i18next's `_one`/`_other` normalization included — so a key
// drawn from `keys` is present in both bundles and the fallback never fires.

const CONCEPTS: { label: string; word: string; pattern: RegExp }[] = [
  { label: "Agent", word: "智能体", pattern: /\bagents?\b/i },
  { label: "Daemon", word: "守护进程", pattern: /\bdaemons?\b/i },
  { label: "Runtime", word: "运行时", pattern: /\bruntimes?\b/i },
  { label: "Squad", word: "小队", pattern: /\bsquads?\b/i },
  // The 151 round's addition. These three are in the voice guide's own
  // "Translate fully — concepts" table (Autopilot → 自动化, Member → 成员) and
  // in its "`issue` is the product's task" rule (→ 任务), but the concept list
  // here had never scanned for them: it only ever covered the four words the
  // 139/140 rounds were chasing. Three rounds of zh-side scanning (145, and the
  // 151 round's item 3) walked ja/ko instead, so the leak sat behind a green
  // suite. It held 18 keys.
  { label: "Autopilot", word: "自动化", pattern: /\bautopilots?\b/i },
  { label: "Member", word: "成员", pattern: /\bmembers?\b/i },
  { label: "Issue", word: "任务", pattern: /\bissues?\b/i },
];

/**
 * The one carve-out the guide makes for `issue` itself, spelled out rather than
 * hidden in an elision: on a machine-health card the English word is a plain
 * noun for a *problem*, not the filed unit of work, and the guide says so —
 * "`{{count}} issues` on a machine card is `{{count}} 个异常`, not `任务`"
 * (section 2, "`issue` is the product's task"). These keys render 异常 and must
 * keep doing it; the concept scan would otherwise read them as untranslated.
 *
 * A carve-out is pinned in both directions, like every other exception table in
 * this file: the key has to still be here, and it has to still render the
 * problem sense. An entry whose surface got renamed away is dead weight.
 */
const CONCEPT_CARVE_OUT: { key: string; word: string; why: string }[] = [
  {
    key: "runtimes.machine.filters.issues",
    word: "异常",
    why: "machine-health filter — a problem, not a filed task",
  },
  {
    key: "runtimes.machine.metrics.health_clear",
    word: "异常",
    why: "machine-health metric — 'No issues' is 无异常",
  },
  {
    key: "runtimes.machine.metrics.health_issues_other",
    word: "异常",
    why: "machine-health metric — the guide's own worked example",
  },
];

/**
 * English that stays English because it names code or a product surface rather
 * than the concept in prose. Masked before the concept scan, so a string may
 * keep `agent` only as part of one of these.
 *
 * Each entry is a literal, not a regex: it must appear verbatim in the bundle,
 * and the last case below pins that, so nobody "finishes the translation" by
 * rewriting the branch prefix or the CLI example into Chinese.
 */
const CODE_LITERALS: { literal: string; why: string }[] = [
  { literal: "Agent Builder", why: "product surface — the builder screen's own name" },
  { literal: "agent/…", why: "git branch prefix handed back by a worktree run" },
  { literal: "@squad", why: "mention token, typed by the user" },
  { literal: "agent --model", why: "CLI example in a command-name placeholder" },
  {
    literal: "/issue",
    why: "the Slack / Lark slash command — the guide keeps literal commands English",
  },
];

const PLACEHOLDER = /\{\{[^}]*\}\}/g;
const CODE_SPAN = /`[^`]*`/g;

/**
 * Everything that is never prose: bindings, code spans, and the documented
 * literals, masked to a character no token pattern can match. Callers use the
 * masked string for "is there a concept token here"; the original is used for
 * "does the Chinese word appear here".
 */
function mask(value: string): string {
  let out = value.replace(PLACEHOLDER, " ").replace(CODE_SPAN, " ");
  for (const { literal } of CODE_LITERALS) out = out.split(literal).join("\u0000");
  return out;
}

const offendersFor = (predicate: (key: string) => string | null) =>
  keys.map(predicate).filter((value): value is string => value !== null);

/**
 * EN names the concept but the zh line drops the noun, because the screen or
 * the surrounding sentence already scopes it: a screen title above a button, a
 * sentence *suffix* concatenated after a prefix that names the concept, a
 * verb-only fragment under a list of targets. Dropping the noun is correct
 * there — repeating it reads like a machine translation — so these are pinned
 * rather than translated. The concept is dropped, never swapped for a competing
 * word; the last suite below is what stops 运行环境 for Runtime.
 */
const CONCEPT_ELIDED: { key: string; why: string }[] = [
  // Buttons and status lines inside the Agent Builder screen, whose own title
  // and body already say 智能体 / Agent Builder.
  { key: "agents.creation_studio.create_and_open", why: "button on the builder screen" },
  { key: "agents.creation_studio.creating", why: "status line on the builder screen" },
  { key: "agents.toolbar.result_count_title", why: "count caption under the agents table" },
  // "This target's agent CLI" — 该目标 *is* the agent; naming it twice repeats
  // the subject.
  {
    key: "issues.comment.trigger_blocked_runtime_unusable",
    why: "该目标 is the agent, already the sentence's subject",
  },
  // Verb-only fragment rendered beneath the list of trigger targets.
  { key: "issues.comment.trigger_none_will_trigger", why: "verb-only fragment" },
  // Sentence suffix concatenated after feature_co_author_description_prefix,
  // which already carries 智能体.
  {
    key: "settings.github.feature_co_author_description_suffix",
    why: "suffix; the prefix names the concept",
  },
  // "Auto-subscribed to every issue this autopilot creates" — the sentence is
  // about the runs the autopilot produces, so it names 任务 and never needs to
  // repeat the feature's name. Added by the 151 round with the Autopilot rule.
  {
    key: "autopilots.dialog.subscribers_hint",
    why: "the sentence names what the autopilot produces, not the feature",
  },
];

describe("zh-Hans glossary: concepts are never left in English", () => {
  it("keeps every surviving concept token on the code-reference list", () => {
    const offenders = offendersFor((key) => {
      const masked = mask(zh[key] ?? "");
      const leaked = CONCEPTS.filter(({ pattern }) => pattern.test(masked)).map(
        ({ label }) => label,
      );
      return leaked.length
        ? `${key}: ${leaked.join("/")} survived in ${JSON.stringify(zh[key])} (en: ${JSON.stringify(en[key])})`
        : null;
    });
    expect(offenders).toEqual([]);
  });

  it("renders the concept in Chinese wherever the English names it", () => {
    const elided = new Set(CONCEPT_ELIDED.map(({ key }) => key));
    const carvedOut = new Set(CONCEPT_CARVE_OUT.map(({ key }) => key));
    const offenders = offendersFor((key) => {
      if (elided.has(key) || carvedOut.has(key)) return null;
      const maskedEn = mask(en[key] ?? "");
      const named = CONCEPTS.filter(({ pattern }) => pattern.test(maskedEn));
      if (!named.length) return null;
      const missing = named.filter(({ word }) => !(zh[key] ?? "").includes(word));
      return missing.length
        ? `${key}: expected ${missing.map(({ word }) => word).join("/")} in ${JSON.stringify(zh[key])} (en: ${JSON.stringify(en[key])})`
        : null;
    });
    expect(offenders).toEqual([]);
  });

  it("keeps every carve-out rendering the sense the guide carved out", () => {
    // The guide's machine-health exception is the only reason these keys may
    // skip the concept word, so they have to still be machine-health copy
    // saying 异常. A carve-out that outlived its surface would silently exempt
    // whatever took the key over.
    const offenders = CONCEPT_CARVE_OUT.filter(
      ({ key, word }) => !(zh[key] ?? "").includes(word),
    ).map(
      ({ key, word }) =>
        `${key}: carve-outs must render ${word}, got ${JSON.stringify(zh[key] ?? null)} — drop the carve-out if the surface is gone`,
    );
    expect(offenders).toEqual([]);
  });

  it("keeps each code reference literal, so nobody translates it by accident", () => {
    const joined = keys.map((key) => zh[key] ?? "").join("\n");
    const offenders = CODE_LITERALS.filter(({ literal }) => !joined.includes(literal)).map(
      ({ literal, why }) => `${JSON.stringify(literal)} is gone — it is ${why}`,
    );
    expect(offenders).toEqual([]);
  });

  it("keeps every code reference where the English put it", () => {
    // Presence *somewhere* in the bundle is not enough: `agent/…` appears in two
    // project strings, so deleting it from one left the bundle-wide check green.
    // Match the English source instead — a key that has the literal in EN keeps
    // it in zh.
    const offenders = keys.flatMap((key) =>
      CODE_LITERALS.filter(
        ({ literal }) => (en[key] ?? "").includes(literal) && !(zh[key] ?? "").includes(literal),
      ).map(({ literal }) => `${key}: ${JSON.stringify(literal)} dropped from ${JSON.stringify(zh[key])}`),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps every command and identifier the English backticks", () => {
    // A code span is a command or an identifier — `openclaw agent --local …` is
    // typed, not read. Deleting one leaves the string fully Chinese, so the
    // concept rules see nothing wrong; only matching the English source does.
    const offenders = keys.flatMap((key) =>
      [...new Set((en[key] ?? "").match(/`[^`]*`/g) ?? [])]
        .filter((span) => !(zh[key] ?? "").includes(span))
        .map((span) => `${key}: ${span} dropped from ${JSON.stringify(zh[key])}`),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps every elision real, so a translated string cannot hide behind one", () => {
    // An entry that no longer elides anything is dead weight that would let a
    // later regression through unnoticed.
    const offenders = CONCEPT_ELIDED.filter(({ key }) => {
      const named = CONCEPTS.filter(({ pattern }) => pattern.test(mask(en[key] ?? "")));
      return named.every(({ word }) => (zh[key] ?? "").includes(word));
    }).map(({ key }) => `${key}: no longer elides a concept — drop it from CONCEPT_ELIDED`);
    expect(offenders).toEqual([]);
  });

  it("classifies the whole bundle, so the rule cannot pass by scanning nothing", () => {
    // A guard that silently reads an empty bundle is worse than no guard: it
    // reports green on a deleted file. Pin the shape it was written against.
    expect(keys.length).toBeGreaterThan(2500);
    expect(namespaces(TARGET_LOCALE)).toEqual(namespaces(SOURCE_LOCALE));
  });
});

/**
 * The four concepts are one rule, but they are not one vocabulary: `Daemon` and
 * `Runtime` are internal nouns the bundle had partially translated, while
 * `Agent` and `Squad` are the words the product's own screens are named after.
 *
 * This suite exists because the Latin-character scan that produced the round's
 * worklist cannot see the failure it guards: 运行环境 is entirely Chinese. The
 * zh-Hans bundle had exactly one such leak (modals.run_confirm.note_unsupported),
 * which the concept scan above reported as *clean* — the English word was gone.
 * Pinning the wrong rendering is the only way to catch that class.
 */
describe("zh-Hans glossary: the settled concept vocabulary", () => {
  it("never renders a concept with a competing Chinese word", () => {
    const banned: { pattern: RegExp; concept: string; word: string }[] = [
      { pattern: /运行环境/, concept: "Runtime", word: "运行时" },
      { pattern: /守护程序/, concept: "Daemon", word: "守护进程" },
      { pattern: /(^|[^智能])代理(?!器)/, concept: "Agent", word: "智能体" },
      { pattern: /团队小队/, concept: "Squad", word: "小队" },
    ];
    const offenders = keys.flatMap((key) =>
      banned
        .filter(({ pattern }) => pattern.test(zh[key] ?? ""))
        .map(
          ({ concept, word }) =>
            `${key}: ${concept} should be ${word}, got ${JSON.stringify(zh[key])}`,
        ),
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * Guard for the last Latin family the 141 round left behind: the four ordinary
 * English nouns `Server`, `toolkit`, `provider` and `handler` that sat inside
 * Chinese sentences in `agents.json` / `settings.json`.
 *
 * They are not concepts the voice guide lists, so the rule is derived from the
 * bundle rather than from the glossary — the same way the 141 round derived the
 * `Body` / `clone` / `review` / `Key` rule. Each one was classified before it
 * was touched, and the classification is what this suite encodes:
 *
 *   `Server`   → 服务器. Not a judgment call: the mobile bundle has already
 *                settled this exact concept as MCP 服务器 (`mcp.title`,
 *                `mcp.agent.hint`), and the two bundles rendering one screen's
 *                vocabulary two ways is the drift, not the translation. The
 *                family had also drifted *within* views — the `workspace_*`
 *                keys said MCP 服务 (service) where the EN says "MCP servers".
 *   `toolkit`  → kept. Composio's own API object name, sitting next to the
 *                equally literal `auth config` in the same strings; a vendor's
 *                object vocabulary is not prose. Closed exception table below.
 *   `provider` → 提供方, which the bundle already uses (`default_provider`,
 *                `detail_provider`). The 141 round's worklist counted
 *                `skills.*.source_runtime_provider` as a leak, but `provider`
 *                there is only a `{{binding}}` name — masking it leaves no
 *                English at all, so those keys are not exceptions, they are
 *                simply not prose.
 *   `handler`  → 处理器 in the `demo.*` fixture prose. The two `demo.run.tasks`
 *                titles name a code module ("Migrate issue handler") and stay
 *                literal — the same split the mobile bundle makes.
 *
 * `my-server` is an example value the user types, not a noun, so it is
 * classified rather than translated. The exception table is pinned as an
 * equality in both directions: an unclassified token fails, and so does an
 * entry whose token has since been translated away.
 */
const LATIN_FAMILY = /\b(servers?|toolkits?|providers?|handlers?)\b/gi;

const LATIN_FAMILY_ALLOWED: { key: string; token: string; why: string }[] = [
  {
    key: "settings.composio.not_enabled_description_suffix",
    token: "toolkit",
    why: "Composio's API object name, literal like `auth config` beside it",
  },
  {
    key: "settings.composio.loading",
    token: "toolkit",
    why: "Composio's API object name",
  },
  {
    key: "settings.composio.load_failed",
    token: "toolkit",
    why: "Composio's API object name",
  },
  {
    key: "settings.composio.empty_description",
    token: "toolkit",
    why: "Composio's API object name",
  },
  {
    key: "settings.composio.search_placeholder",
    token: "toolkit",
    why: "Composio's API object name",
  },
  {
    key: "settings.composio.disconnect_confirm_description",
    token: "toolkit",
    why: "Composio's API object name",
  },
  {
    key: "agents.tab_body.composio_mcp.subtitle",
    token: "toolkit",
    why: "Composio's API object name — the MCP server half of this string is translated",
  },
];

const latinFamilyTokens = (key: string) => [
  ...new Set((mask(zh[key] ?? "").match(LATIN_FAMILY) ?? []).map((t) => t.toLowerCase())),
];

describe("zh-Hans glossary: the Server / toolkit / provider / handler family", () => {
  it("classifies every surviving Latin token, so a new one cannot slip in", () => {
    const allowed = new Set(
      LATIN_FAMILY_ALLOWED.map(({ key, token }) => `${key}:${token}`),
    );
    const offenders = keys.flatMap((key) =>
      latinFamilyTokens(key)
        .filter((token) => !allowed.has(`${key}:${token}`))
        .map(
          (token) =>
            `${key}: ${token} survived in ${JSON.stringify(zh[key])} (en: ${JSON.stringify(en[key])})`,
        ),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps every exception real, so a translated string cannot hide behind one", () => {
    const offenders = LATIN_FAMILY_ALLOWED.filter(
      ({ key, token }) => !latinFamilyTokens(key).includes(token),
    ).map(
      ({ key, token }) =>
        `${key}: ${token} is gone — drop it from LATIN_FAMILY_ALLOWED`,
    );
    expect(offenders).toEqual([]);
  });

  it("never renders an MCP server as a bare 服务 on an MCP server surface", () => {
    // The Latin scan above cannot see this: 服务 is entirely Chinese. It is
    // the class the 141 round's competing-vocabulary suite was built for —
    // the English word is gone and the wrong Chinese one took its place.
    //
    // Scoped to the two surfaces that are *only* about MCP servers, because
    // 服务 is correct elsewhere in the bundle (服务端 "server-side",
    // 账单服务, 模型服务, 第三方服务, 服务中). `settings.mcp.*` needs the
    // scope rather than an `MCP ` prefix: its short labels say 添加服务 /
    // 编辑服务, with no acronym in sight.
    const MCP_SURFACES = ["settings.mcp.", "agents.tab_body.mcp_config."];
    const offenders = keys
      .filter((key) => MCP_SURFACES.some((prefix) => key.startsWith(prefix)))
      .filter((key) => /服务(?!器)/.test(zh[key] ?? ""))
      .map((key) => `${key}: 服务 should be 服务器 — ${JSON.stringify(zh[key])}`);
    expect(offenders).toEqual([]);
  });

  it("keeps the settled Chinese words this round chose", () => {
    const settled: Record<string, RegExp> = {
      "agents.tab_body.mcp_config.intro": /MCP 服务器/,
      "agents.tab_body.mcp_config.delete_action": /服务器/,
      "agents.tab_body.mcp_config.dialog_name_required": /服务器/,
      "agents.tab_body.mcp_config.workspace_hint": /MCP 服务器/,
      "agents.tab_body.mcp_config.dialog_native_json_hint": /提供方/,
      "agents.tab_body.mcp_config.dialog_url_label": /服务器/,
      "agents.tab_body.composio_mcp.subtitle": /MCP 服务器/,
      // The short labels in the workspace MCP library, where the acronym is
      // nowhere near the noun and the wrong word is easiest to restore.
      "settings.mcp.add_server": /添加服务器/,
      "settings.mcp.edit_server": /编辑服务器/,
      "settings.mcp.remove_server": /移除服务器/,
      "settings.mcp.servers_title": /共享服务器/,
    };
    const offenders = Object.entries(settled)
      .filter(([key, pattern]) => !pattern.test(zh[key] ?? ""))
      .map(([key]) => `${key}: lost the word this round settled on`);
    expect(offenders).toEqual([]);
  });
});

/**
 * Guard for the squad surfaces the 143 round scanned (squad detail, create-squad
 * modal). Both rendered the squad role in Latin.
 *
 * `leader` is not one of the role enums the voice guide leaves untranslated —
 * that rule names `owner` / `admin` / `member`. It is the squad role, and the
 * bundle had already settled it as 队长 in ten of the eleven strings that
 * mention it, including the label on the very chip the leak sat above
 * (`squads.new.leader`: 'Leader' → 队长). Both holdouts were prose, so the rule
 * is derived from the bundle rather than from the glossary: nothing here spells
 * the role in Latin.
 *
 * The same sentence also kept `prompt`, so it is pinned too. The bundle's split
 * for that word is prose → 提示词 versus a Latin label naming a code field, and
 * "the leader agent's prompt" is prose. The 144 round then derived the field
 * half of that split properly — it is the compound `System Prompt` that stays
 * Latin, not the bare word `Prompt`; see the `field_prompt` guard below.
 */
describe("zh-Hans glossary: the squad leader", () => {
  it("never spells the squad role in Latin", () => {
    const offenders = keys
      .filter((key) => /\bleaders?\b/i.test(mask(zh[key] ?? "")))
      .map((key) => `${key}: 队长 for the squad role — ${JSON.stringify(zh[key])}`);
    expect(offenders).toEqual([]);
  });

  it("keeps the two squad strings this round settled", () => {
    const settled: Record<string, RegExp> = {
      "squads.instructions_tab.description": /队长智能体.*提示词/,
      "modals.create_squad.members_hint": /^队长可以委派/,
    };
    const offenders = Object.entries(settled)
      .filter(([key, pattern]) => !pattern.test(zh[key] ?? ""))
      .map(([key]) => `${key}: lost the word this round settled on`);
    expect(offenders).toEqual([]);
  });
});

/**
 * Guard for the `field_prompt` divergence the 143 round recorded and left open:
 * the same English source string, `Prompt`, labelled a textarea on the
 * autopilot detail panel as `Prompt` and on the quick-actions form as 提示词.
 *
 * The rule is derived from the source bundle rather than from a key list. Every
 * key whose EN string is exactly `Prompt` is the same thing — a field label
 * sitting above a prompt textarea — so it takes the same Chinese word, and this
 * bundle had already settled that word in three of the four cells that existed
 * across the two bundles (`settings.quick_actions.field_prompt` here, both
 * mobile keys there). The rest of the evidence agrees: the sibling `field_*`
 * labels on the very same autopilot panel are all translated (智能体 / 创建者 /
 * 输出模式 / 关联项目 / 订阅者), and ja and ko translate both cells. The autopilot
 * label was the lone holdout.
 *
 * The compound `System prompt` is a different source string — the name of the
 * agent's config field — and stays Latin, so the rule is two-sided rather than
 * "translate every string containing Prompt".
 */
describe("zh-Hans glossary: a field labelled Prompt", () => {
  const BARE_PROMPT = "Prompt";
  const barePromptKeys = Object.entries(en)
    .filter(([, source]) => source === BARE_PROMPT)
    .map(([key]) => key)
    .sort();

  it("renders the bare source word `Prompt` as 提示词", () => {
    const offenders = barePromptKeys
      .filter((key) => (zh[key] ?? "") !== "提示词")
      .map(
        (key) =>
          `${key}: a field label for a prompt input is 提示词 — ${JSON.stringify(zh[key])}`,
      );
    expect(offenders).toEqual([]);
  });

  it("still finds that label on more than one surface", () => {
    // The rule is only worth deriving while the source word labels several
    // screens. If a refactor collapses them to one key, a green run here would
    // stop meaning anything, so pin the set the derivation rests on.
    expect(barePromptKeys).toEqual([
      "autopilots.detail.field_prompt",
      "settings.quick_actions.field_prompt",
    ]);
  });

  it("leaves the compound `System prompt` in Latin", () => {
    // The other side of the rule. This label stays literal because its source
    // string is the compound term, not the bare word — which is also why the
    // rule above cannot reach it: `System prompt` !== `Prompt`.
    const key = "agents.tab_body.instructions.system_prompt_label";
    expect(en[key]).toBe("System prompt");
    expect(zh[key]).toBe("System Prompt");
  });
});

/**
 * Guard for the `skill` concept, which the 144 round's skill-detail track scan
 * found the two bundles spelling two ways. This bundle was nearly clean — it
 * keeps the lowercase English word the voice guide mandates — but eight keys
 * spelled it 技能: the skill detail page's own overview hints and aria labels,
 * and the editor's slash-command empty states. The mobile bundle had the same
 * drift on 62 keys, so both sides were settled in that round.
 *
 * The guide is explicit rather than a judgement call: "`skill` keeps lowercase
 * English in Chinese text — a Multica-specific concept with no established
 * Chinese term; titles may capitalize as `Skills`". The Chinese docs back it
 * (475 `skill` to 1 技能), and this bundle already follows the same rule for
 * `task`, the other Multica-specific term.
 *
 * Derived from the source bundle: if the English names a skill, the Chinese
 * keeps the Latin token. This bundle elides the noun nowhere, so unlike the
 * mobile guard the rule carries no exception list.
 */
describe("zh-Hans glossary: the skill concept stays lowercase English", () => {
  it("keeps the Latin token wherever the English source names a skill", () => {
    const offenders = keys
      .filter((key) => /\bskills?\b/i.test(en[key] ?? ""))
      .filter((key) => !/\bskills?\b/i.test(zh[key] ?? ""))
      .map((key) => `${key}: the Latin token skill/Skills — ${JSON.stringify(zh[key])}`);
    expect(offenders).toEqual([]);
  });

  it("never renders the concept with a Chinese word", () => {
    // The other side of the rule: a key could keep the Latin token *and* spell
    // the concept in Chinese, which the test above would not notice. 技能 is the
    // word this bundle used before the 144 round.
    const offenders = keys
      .filter((key) => (zh[key] ?? "").includes("技能"))
      .map((key) => `${key}: the Latin token skill/Skills, never a Chinese word`);
    expect(offenders).toEqual([]);
  });

  it("still covers the detail page the scan walked", () => {
    // The rule is only worth deriving while it reaches the surfaces the scan
    // found the leak on; a green run that no longer covers them proves nothing.
    const covered = keys.filter((key) => /\bskills?\b/i.test(en[key] ?? ""));
    expect(covered).toContain("skills.detail.overview.description_hint");
    expect(covered).toContain("skills.detail.files.list_aria");
    expect(covered).toContain("editor.slash_command.no_results");
  });
});
