import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard for the zh half of the mandatory translation glossary
 * (apps/docs/content/docs/developers/conventions.mdx, section 2).
 *
 * The load-bearing rule is the entity split: the filed unit of work (`issue`)
 * is **任务**, while one agent execution run (`task`) stays lowercase **task**.
 * A locale must never spell both with the same word, so this suite pins both
 * directions and fails when a new string leaks 问题 for the entity or 任务 for
 * a run. Classification is derived from the en bundle wherever the wording is
 * explicit; the lists below are the documented exceptions.
 */
const LOCALES_DIR = path.resolve(__dirname, "locales");

const zh = JSON.parse(readFileSync(path.join(LOCALES_DIR, "zh.json"), "utf8")) as Record<
  string,
  string
>;
const en = JSON.parse(readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8")) as Record<
  string,
  string
>;

const keys = Object.keys(zh).sort();

/** EN talks about the issue entity, so the zh token must be 任务. */
const ISSUE_ENTITY_PATTERN = /\b(sub-?)?issues?\b/i;

/**
 * 问题 survives only where the English is a *question* or a runtime-health
 * *problem* — never the entity. Mirrors packages/views/locales/zh-Hans, which
 * keeps the same two senses and nothing else.
 */
const PROBLEM_SENSE_KEYS = [
  "agents.new.ai.description", // "will ask focused questions"
  "usage.errors.byAgent", // "Top offenders" — failed runs, not filed issues
];

/** EN spells out the entity with 异常 instead: health problems, not issues. */
const RUNTIME_HEALTH_KEYS = [
  "runtimes.machine.filters.issues",
  "runtimes.machine.metrics.health_clear",
  "runtimes.machine.metrics.health_issues_one",
  "runtimes.machine.metrics.health_issues_other",
];

/** "issue" here names a code artifact, not the entity. */
const CODE_REFERENCE_KEYS = [
  "demo.run.tasks.two.title", // "Migrate issue handler" — module name, cf. tasks.three
];

/**
 * EN wording carries no "issue" token, but the string is about the entity
 * (a parent/child reference, a demo line, an agent-composed issue placeholder).
 */
const ISSUE_SENSE_NO_TOKEN_KEYS = [
  "demo.issue.activity",
  "issues.swimlane.groupNoParent",
  "issues.swimlane.groupOtherParents",
  "myIssues.emptyAll",
  "newIssue.agentPlaceholder",
  "newIssue.agentSentBody",
  "newIssue.agentSentTitle",
  "newIssue.parentChipClear",
  "projects.column.issues",
  "timeline.subtasks",
];

/** Every key that legitimately renders the run entity as lowercase `task`. */
const RUN_SENSE_KEYS = [
  "activity.completedTask",
  "activity.completedTasks",
  "activity.failedTask",
  "activity.failedTasks",
  "agents.activity.empty30d",
  "agents.activity.emptyNow",
  "agents.activity.emptyRecent",
  "agents.activity.subtitleActive",
  "agents.activity.subtitleNoActive",
  "agents.activity.transcriptTitle",
  "agents.detail.cancelConfirm",
  "agents.detail.cancelFailedTitle",
  "agents.detail.cancelIrreversible",
  "agents.detail.cancelMenu",
  "agents.detail.cancelNoTasks",
  "agents.detail.cancelRunningNote",
  "agents.detail.cancelSuccessOne",
  "agents.detail.cancelSuccessOther",
  "agents.detail.cancelTitle",
  "agents.detail.noTasks",
  "agents.detail.tasks",
  "agents.emptyDescription",
  "agents.taskCount",
  "autopilots.emptyHint",
  "billing.limitsIssues",
  "billing.limitsIssuesDescription",
  "chat.emptyFirstLine",
  "demo.run.taskHeader",
  "failureReason.timeout",
  "inbox.emptySubtitle",
  "inbox.type.task_completed",
  "inbox.type.task_failed",
  "issue.qa.coalesced",
  "notif.groupAgentActivityDesc",
  "plugins.disabled",
  "resource.localRuntimeHint",
  "resource.modeDescription",
  "resource.modeInPlaceDescription",
  "resource.modeTitle",
  "resource.modeWorktreeDescription",
  "runs.cancelTask",
  "runs.cancelTaskTitle",
  "runs.kind.chat",
  "runs.kind.comment",
  "runs.kind.task",
  "runs.retryFailed",
  "runtimes.connect.successDescription",
  "runtimes.row.taskCount",
  "squads.detail.activeTask",
  "squads.instructions.description",
  "usage.dayTrendTasksTitle",
  "usage.emptyDescription",
  "usage.errors.kpiFailedLabel",
  "usage.metricTasks",
  "usage.tasksShort",
  "usage.totalRunTimeHint",
  "usage.totalTasks",
  "usage.weekTrendTasksTitle",
];

const withValue = (predicate: (value: string) => boolean) => keys.filter((key) => predicate(zh[key]));
const mismatch = (key: string, expected: string) =>
  `${key}: expected ${expected}, got ${JSON.stringify(zh[key])} (en: ${JSON.stringify(en[key])})`;

describe("zh glossary: issue entity is 任务", () => {
  it("keeps 问题 only for the question / runtime-health senses", () => {
    expect(withValue((v) => v.includes("问题")).sort()).toEqual([...PROBLEM_SENSE_KEYS].sort());
  });

  it("translates every entity mention as 任务, never a raw English issue", () => {
    const exempt = new Set([
      ...PROBLEM_SENSE_KEYS,
      ...RUNTIME_HEALTH_KEYS,
      ...CODE_REFERENCE_KEYS,
      ...RUN_SENSE_KEYS,
    ]);
    const offenders = keys
      .filter((key) => ISSUE_ENTITY_PATTERN.test(en[key] ?? ""))
      .filter((key) => !exempt.has(key))
      .filter((key) => {
        // `/issue` is a literal slash command and stays English.
        const stripped = zh[key].replace(/\/issues?\b/g, "");
        return !zh[key].includes("任务") || ISSUE_ENTITY_PATTERN.test(stripped);
      });
    expect(offenders.map((key) => mismatch(key, "a 任务 string with no raw issue token"))).toEqual(
      [],
    );
  });

  it("never spells a run with 任务", () => {
    const issueSense = new Set([
      ...keys.filter((key) => ISSUE_ENTITY_PATTERN.test(en[key] ?? "")),
      ...ISSUE_SENSE_NO_TOKEN_KEYS,
    ]);
    const offenders = withValue((v) => v.includes("任务")).filter((key) => !issueSense.has(key));
    expect(offenders.map((key) => mismatch(key, "the run term `task`"))).toEqual([]);
  });
});

describe("zh glossary: agent run is lowercase task", () => {
  it("renders every run string with `task` and no 任务", () => {
    const offenders = RUN_SENSE_KEYS.filter((key) => !zh[key]?.includes("task")).map((key) =>
      mismatch(key, "a `task` string"),
    );
    // A run string may also name the issue entity ("assigns an issue, or an
    // agent finishes a task"); only a run-only string must be free of 任务.
    const collisions = RUN_SENSE_KEYS.filter(
      (key) => zh[key]?.includes("任务") && !ISSUE_ENTITY_PATTERN.test(en[key] ?? ""),
    ).map((key) => mismatch(key, "no 任务"));
    expect([...offenders, ...collisions]).toEqual([]);
  });

  it("leaves no run string outside the classified list", () => {
    const offenders = withValue((v) => v.includes("task")).filter(
      (key) => !RUN_SENSE_KEYS.includes(key),
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * Guard for the rest of the "Translate fully — concepts" column
 * (apps/docs/content/docs/developers/conventions.mdx, section 2), plus `squad`,
 * which this bundle already renders as 小队 in every `squads.*` string.
 *
 * `task` is deliberately absent: one agent execution run keeps the lowercase
 * English word (pinned above). These concepts, by contrast, are prose and must
 * never survive as English words in a zh string — that is how the 139 round
 * found ~120 `agent(s)` / `daemon` / `runtime` / `squad` leaks that the
 * packages/views locales had already fixed.
 */
const CONCEPT_TERMS: { label: string; zh: string; pattern: RegExp }[] = [
  { label: "智能体", zh: "智能体", pattern: /\bagents?\b/i },
  { label: "守护进程", zh: "守护进程", pattern: /\bdaemons?\b/i },
  { label: "Runtime", zh: "运行时", pattern: /\bruntimes?\b/i },
  { label: "小队", zh: "小队", pattern: /\bsquads?\b/i },
];

/**
 * `{{name}}`-style placeholders are code identifiers, not prose: `{{agent}}`,
 * `{{runtime}}`, `{{squad}}` and `{{label}}` must not trip a concept rule.
 */
const PLACEHOLDER = /\{\{[^}]*\}\}/g;
const prose = (value: string | undefined) => (value ?? "").replace(PLACEHOLDER, "");

/**
 * Latin runs left in a zh string — `Stripe`, `Cloud Billing`, `agent/…`-style
 * references. Placeholders are stripped first: `{{count}}` is a binding, not
 * prose, and never a translation decision.
 */
const LATIN_RUN = /[A-Za-z][A-Za-z0-9]*(?:[./_-][A-Za-z0-9]+)*/g;
const latinTokens = (value: string) => value.match(LATIN_RUN) ?? [];
const CJK = /[一-鿿]/;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * English that survives on purpose because it names code, a CLI command or a
 * product surface — never the concept in prose.
 */
const CONCEPT_CODE_REFERENCES = [
  "agents.new.ai.description", // "Agent Builder" — product surface name
  "notif.groupMentionsDesc", // "@squad" — mention token
  "onboarding.runtime.step2", // "multica daemon" — the CLI subcommand
  "resource.modeWorktreeDescription", // "agent/…" — git branch prefix
  "runtimes.profiles.form.commandPlaceholder", // "agent --model …" — CLI example
];

/**
 * EN names the concept but the zh line elides the noun, because the screen or
 * the surrounding sentence already scopes it (a screen title, a target list,
 * one half of a prefix/suffix pair). The concept is dropped, never rendered
 * with a competing word — 运行环境 for Runtime is exactly what this stops.
 */
const CONCEPT_ELIDED_KEYS = [
  "agents.new.failedTitle",
  "agents.new.runtimeRequired",
  "comment.trigger_blocked_runtime_unusable",
  "comment.trigger_none_will_trigger",
  "integrations.gh.coAuthorSuffix",
  "runtimes.detail.renameFailed",
  "squads.detail.archiveMessage",
];

describe("zh glossary: concepts are never left in English", () => {
  it("keeps every surviving English token on the code-reference list", () => {
    const offenders = CONCEPT_TERMS.flatMap(({ label, pattern }) =>
      keys
        .filter((key) => !CONCEPT_CODE_REFERENCES.includes(key))
        .filter((key) => pattern.test(prose(zh[key])))
        .map((key) => `${label}: ${mismatch(key, "a Chinese rendering")}`),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps each code reference literal, so nobody 'fixes' it by accident", () => {
    const expected: Record<string, string> = {
      "agents.new.ai.description": "Agent Builder",
      "notif.groupMentionsDesc": "@squad",
      "onboarding.runtime.step2": "multica daemon",
      "resource.modeWorktreeDescription": "agent/…",
      "runtimes.profiles.form.commandPlaceholder": "agent --model",
    };
    const offenders = Object.entries(expected)
      .filter(([key, token]) => !zh[key]?.includes(token))
      .map(([key, token]) => mismatch(key, `the literal ${JSON.stringify(token)}`));
    expect(offenders).toEqual([]);
  });

  it("renders the concept in Chinese wherever the English names it", () => {
    const exempt = new Set([...CONCEPT_CODE_REFERENCES, ...CONCEPT_ELIDED_KEYS]);
    const offenders = CONCEPT_TERMS.flatMap(({ label, zh: word, pattern }) =>
      keys
        .filter((key) => pattern.test(prose(en[key])))
        .filter((key) => !exempt.has(key))
        .filter((key) => !zh[key].includes(word))
        .map((key) => `${label}: ${mismatch(key, `a ${word} string`)}`),
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * Guard for the `billing.*` family — the pocket the 139 round's bare
 * Latin-character scan called the one scalable stretch of untranslated prose
 * left (23 tokens across 15 keys). Classifying each token overturns that: they
 * are the Stripe and Google Cloud *surfaces the user is handed off to*, plus
 * two standard tokens. `checkout`, `portal`, `entitlement` and `quantity`
 * survive verbatim in the ja and ko bundles under packages/views/locales/ —
 * locales with no shared script and no habit of borrowing English — which is
 * what separates a product name from a leak. Renaming the destination page in
 * zh would make the copy stop naming the page it points at.
 *
 * `entitlement` and `quantity` are the exception: internal server vocabulary,
 * not product names, both with a settled Chinese word. This round translated
 * them (权益 / 数量) and the last case below pins that, so no later sweep
 * restores them.
 *
 * The allow-list is deliberately closed. A new English word in billing copy
 * fails this suite until someone classifies it here, which is the whole point:
 * the scan that produced this list was a heuristic, and heuristics rot.
 */
const BILLING_ALLOWED_LATIN = new Set([
  "Stripe", // brand
  "Cloud", // "Cloud Billing" — Google Cloud surface
  "Billing", // "Billing Portal" / "Cloud Billing" — product surface
  "Portal", // "Billing Portal" — product surface
  "Checkout", // "Checkout" / "Stripe Checkout" — product surface
  "UTC", // standard token, not prose
  "Free", // plan tier names — same rule that keeps `skill` English
  "Pro",
  "task", // one agent run, lowercase English per the glossary
  "owner", // role enums stay lowercase English
  "admin",
]);

/** Product surfaces, and the exact spelling the destination page uses. */
const BILLING_SURFACES: { en: RegExp; literal: string }[] = [
  { en: /Stripe Checkout/, literal: "Stripe Checkout" },
  { en: /Stripe Billing Portal/, literal: "Stripe Billing Portal" },
  { en: /Billing Portal/, literal: "Billing Portal" },
  { en: /Cloud Billing/i, literal: "Cloud Billing" },
  { en: /\bCheckout\b/, literal: "Checkout" },
];

describe("zh glossary: billing copy keeps the Stripe surfaces literal", () => {
  const billingKeys = keys.filter((key) => key.startsWith("billing."));

  it("classifies every Latin token in the family, so no new prose slips in", () => {
    const offenders = billingKeys.flatMap((key) =>
      latinTokens(prose(zh[key]))
        .filter((token) => !BILLING_ALLOWED_LATIN.has(token))
        .map((token) => `${key}: unclassified ${JSON.stringify(token)}`),
    );
    expect(offenders).toEqual([]);
  });

  it("names each product surface the way the destination page does", () => {
    const offenders = BILLING_SURFACES.flatMap(({ en: pattern, literal }) =>
      billingKeys
        .filter((key) => pattern.test(prose(en[key])))
        .filter((key) => !zh[key].includes(literal))
        .map((key) => mismatch(key, `the literal ${JSON.stringify(literal)}`)),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps one space between every surviving English token and the Chinese", () => {
    const offenders = billingKeys.flatMap((key) => {
      const value = zh[key];
      return latinTokens(value).flatMap((token) =>
        [...value.matchAll(new RegExp(escapeRegex(token), "g"))].flatMap(({ index }) => {
          const before = value[index - 1];
          const after = value[index + token.length];
          const where: string[] = [];
          if (before && CJK.test(before)) where.push(`no space before ${JSON.stringify(token)}`);
          if (after && CJK.test(after)) where.push(`no space after ${JSON.stringify(token)}`);
          return where.map((reason) => `${key}: ${reason}`);
        }),
      );
    });
    expect(offenders).toEqual([]);
  });

  it("never restores the two internal words this round translated", () => {
    const offenders = billingKeys
      .filter((key) => /\b(entitlement|quantity)\b/i.test(zh[key]))
      .map((key) => mismatch(key, "权益 / 数量"));
    expect(offenders).toEqual([]);
  });
});

/**
 * Guard for the punctuation half of the Chinese voice guide
 * (apps/docs/content/docs/developers/conventions.mdx, section 3).
 *
 * The 140 round's search-page track scan surfaced this. The two earlier scans
 * both keyed on Latin characters, and `「」` / `“”` are not Latin — so 23
 * strings kept the exact characters the guide forbids ("Quotes: straight
 * double quotes ... Do not use `「」` or curly quotes") and no test noticed.
 *
 * Not guarded here: the guide's ellipsis clause ("three dots `...` not the
 * single character `…`") contradicts its own "match the English source"
 * clause, because the en bundle itself uses `…` in 95 strings and `...` in 11.
 * Pinning either reading rewrites a hundred strings, so the contradiction is
 * reported for the docs owner instead of silently resolved here.
 */
const BANNED_QUOTES = ["「", "」", "“", "”", "‘", "’"] as const;

describe("zh glossary: punctuation follows the Chinese voice guide", () => {
  it("uses no corner brackets and no curly quotes", () => {
    const offenders = keys.flatMap((key) =>
      BANNED_QUOTES.filter((char) => zh[key].includes(char)).map(
        (char) => `${key}: banned ${JSON.stringify(char)} in ${JSON.stringify(zh[key])}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("uses straight double quotes wherever the English source quotes a value", () => {
    const offenders = keys
      .filter((key) => en[key]?.includes('"'))
      .filter((key) => !zh[key].includes('"'))
      .map((key) => mismatch(key, "straight double quotes"));
    expect(offenders).toEqual([]);
  });
});

/**
 * Guard for the three leftover Latin families the 140 round's full-bundle scan
 * turned up (131 unclassified tokens), minus the `billing.*` pocket above.
 *
 * All three are ordinary English common nouns sitting in the middle of Chinese
 * sentences — not product names and not standard notation — and all three have
 * a settled Chinese word:
 *
 *   `Body`  → 请求体 / 响应体   (the delivery record's HTTP payloads; the
 *                                sibling `headers` already reads 请求头, which
 *                                is what fixes the register)
 *   `clone` → 克隆              (what the GitHub Chinese docs use)
 *   `review`→ 审查              (the bundle's own word: `enum.status.in_review`
 *                                is 审查中 and the quick-action placeholders
 *                                say 代码审查 — 评审 appears once, as an
 *                                example, and would have split the vocabulary)
 *
 * `Key` rode along in `dedupeKey`: 去重 Key sat next to 去重来源, so the pair
 * disagreed about whether the noun was translated. It is 去重键 now.
 *
 * Two families below get a closed allow-list that is *pinned as an equality*,
 * not a subset: a new English token fails the suite, and so does an allow-list
 * entry that no longer occurs. That is the property the 140 round's scan
 * lacked — it produced a list, and nothing made anyone re-derive it.
 *
 * `demo.*` is deliberately not covered this way. It is fixture prose — names,
 * brands, module names and a raw status enum (`demo.inbox.row1.detail` renders
 * `in_review` as "In Review", which is the status-enum contract's business,
 * not this one) — so a token list there would be noise, not a decision. The
 * keys this round actually changed are pinned individually instead.
 */
const REPOSITORIES_ALLOWED_LATIN = [
  "Git", // the VCS, and its CLI
  "git",
  "GitHub", // brand
  "Go", // language name, in an example description
  "Next.js", // framework name, same example
  "URL", // abbreviation
  "https", // example URL scheme
  "git.example.com",
  "git.example.com/org/repo.git",
  "org/repo.git",
  "GITHUB_APP_ID", // env var names
  "GITHUB_APP_PRIVATE_KEY",
];

const DELIVERIES_ALLOWED_LATIN = [
  "Content-Type", // HTTP header name
  "POST", // HTTP method
  "URL", // abbreviation
  "Webhook", // loanword the whole family already uses
];

describe("zh glossary: the leftover Latin families are closed", () => {
  const tokensIn = (predicate: (key: string) => boolean) => {
    const found = new Set<string>();
    for (const key of keys) {
      if (!predicate(key)) continue;
      for (const token of latinTokens(prose(zh[key]))) found.add(token);
    }
    return [...found].sort();
  };

  it("classifies every Latin token in the repositories family", () => {
    expect(tokensIn((key) => key.startsWith("repositories."))).toEqual(
      [...REPOSITORIES_ALLOWED_LATIN].sort(),
    );
  });

  it("classifies every Latin token in the autopilot deliveries family", () => {
    expect(tokensIn((key) => key.startsWith("autopilots.deliveries."))).toEqual(
      [...DELIVERIES_ALLOWED_LATIN].sort(),
    );
  });

  it("never restores the four words this round translated", () => {
    const translated: Record<string, RegExp> = {
      "autopilots.deliveries.rawBody": /请求体/,
      "autopilots.deliveries.responseBody": /响应体/,
      "autopilots.deliveries.dedupeKey": /键/,
      "repositories.description": /克隆/,
      "repositories.deleteDescription": /克隆/,
      "repositories.empty": /克隆/,
      "demo.issue.comment": /审查/,
      "demo.section.agents.lede": /审查/,
      "resource.modeWorktreeDescription": /审查/,
    };
    const offenders = Object.entries(translated)
      .filter(([key, pattern]) => !pattern.test(zh[key]))
      .map(([key]) => mismatch(key, "the Chinese word this round settled on"));
    expect(offenders).toEqual([]);
  });

  it("keeps the worktree branch prefix literal while translating around it", () => {
    // `agent/…` is a git branch prefix and must survive verbatim — the same
    // string is the one place a translated `review` and an untranslated branch
    // prefix sit side by side, so it is the one most likely to be "tidied".
    expect(zh["resource.modeWorktreeDescription"]).toContain("agent/…");
  });
});

/**
 * Guard for the same four ordinary English nouns the 141 round left in the
 * views bundle — `Server`, `toolkit`, `provider`, `handler` — on the mobile
 * side. The mobile bundle was already clean on three of them (it renders the
 * MCP concept as 服务器 throughout `mcp.*`, `common.server` and `login.server`,
 * and it is the bundle that settled that word), so what is left to classify is
 * narrow, and the classification is the same one views uses.
 *
 *   `handler` → 处理器 in the `demo.*` fixture prose. The two `demo.run.tasks`
 *               titles name a code module ("Migrate issue handler") and stay
 *               literal — which is why `demo.run.tasks.two.title` is already in
 *               CODE_REFERENCE_KEYS above for the `issue` half of its wording.
 *   `server`  → only `mcp.form.namePlaceholder` keeps it, inside `my-server`:
 *               an example value the user types into the name field, so it is
 *               a value, not a noun. Translating it would make the example
 *               wrong.
 *
 * Pinned as an equality in both directions, like the views table: a new token
 * fails, and so does an entry whose token has since been translated away.
 */
const LATIN_FAMILY = /\b(servers?|toolkits?|providers?|handlers?)\b/gi;

const LATIN_FAMILY_ALLOWED: { key: string; token: string; why: string }[] = [
  {
    key: "demo.run.tasks.two.title",
    token: "handler",
    why: "names a code module — the migration target, not prose",
  },
  {
    key: "demo.run.tasks.three.title",
    token: "handler",
    why: "names a code module — the migration target, not prose",
  },
  {
    key: "mcp.form.namePlaceholder",
    token: "server",
    why: "an example value inside `my-server`, which the user types verbatim",
  },
];

const latinFamilyTokens = (key: string) => [
  ...new Set(
    (prose(zh[key]).match(LATIN_FAMILY) ?? []).map((token) => token.toLowerCase()),
  ),
];

describe("zh glossary: the Server / toolkit / provider / handler family", () => {
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
      ({ key, token }) => `${key}: ${token} is gone — drop it from LATIN_FAMILY_ALLOWED`,
    );
    expect(offenders).toEqual([]);
  });

  it("renders the demo prose handler as 处理器, and only the module names stay literal", () => {
    const settled = [
      "demo.chat.reply",
      "demo.issue.body",
      "demo.issue.comment",
    ];
    const offenders = settled
      .filter((key) => !/处理器/.test(zh[key]))
      .map((key) => mismatch(key, "处理器 for the prose sense of handler"));
    expect(offenders).toEqual([]);
  });

  it("keeps the MCP server word the mobile bundle settled, so views can follow it", () => {
    // The views bundle now renders this concept the same way. If mobile drifts
    // back to English there is no longer a settled word for views to match.
    const settled: Record<string, RegExp> = {
      "common.server": /^服务器$/,
      "login.server": /^服务器$/,
      "mcp.agent.title": /MCP 服务器/,
      "mcp.deleted": /服务器/,
    };
    const offenders = Object.entries(settled)
      .filter(([key, pattern]) => !pattern.test(zh[key] ?? ""))
      .map(([key]) => mismatch(key, "the settled word for an MCP server"));
    expect(offenders).toEqual([]);
  });
});

/**
 * Guard for the squad surfaces the 143 round scanned (squad detail, create-squad
 * modal) — both rendered the squad role in Latin.
 *
 * `leader` is not one of the role enums the voice guide leaves untranslated;
 * that rule names `owner` / `admin` / `member`. It is the squad role, and this
 * bundle had already settled it as 队长 in every other string that mentions it,
 * including the label on the very chip the leak sat above (`squads.new.leader`:
 * 'Leader' → 队长). The holdout was prose, so the rule is derived from the
 * bundle: nothing here spells the role in Latin.
 *
 * The same sentence also kept `prompt`, so it is pinned too. The bundle's split
 * for that word is prose → 提示词 versus a Latin label naming a code field, and
 * "the leader agent's prompt" is prose. The 144 round then derived the field
 * half of that split properly — it is the compound `System Prompt` that stays
 * Latin, not the bare word `Prompt`; see the `field_prompt` guard below.
 */
describe("zh glossary: the squad leader", () => {
  it("never spells the squad role in Latin", () => {
    const offenders = withValue((value) => /\bleaders?\b/i.test(prose(value))).map(
      (key) => mismatch(key, "队长 for the squad role"),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the squad instructions blurb on the settled words", () => {
    const key = "squads.instructions.description";
    const value = zh[key] ?? "";
    expect(value).toContain("队长智能体");
    expect(value).toContain("提示词");
  });
});

/**
 * Guard for the word the views bundle now follows for a field labelled with the
 * bare source word `Prompt`. The 143 round recorded that views rendered the
 * autopilot panel's label in Latin while this bundle already had 提示词; the 144
 * round settled views onto 提示词 and derived the rule there.
 *
 * This side is pinned so the settled word keeps an owner: the views guard reads
 * the rule as "every key whose EN source is exactly `Prompt` renders 提示词", and
 * if this bundle drifts back to Latin there is no longer a settled word for it
 * to match. The classification is derived from the source bundle, not listed —
 * a bare `Prompt` is a field label, whereas the compound `System prompt` names
 * the agent's config field and stays Latin (this bundle has no such key yet).
 */
describe("zh glossary: a field labelled Prompt", () => {
  it("renders every key sourced from the bare word `Prompt` as 提示词", () => {
    const offenders = keys
      .filter((key) => en[key] === "Prompt")
      .filter((key) => zh[key] !== "提示词")
      .map((key) => mismatch(key, "提示词 for a field labelled Prompt"));
    expect(offenders).toEqual([]);
  });

  it("leaves no Latin `Prompt` anywhere in the bundle", () => {
    // The source word is bare, so nothing here may keep it. The compound
    // `System Prompt` would be the one legitimate survivor, and it has no key
    // in this bundle — the day one appears, this test asks for the rule.
    const offenders = withValue((value) => /\bPrompt\b/.test(prose(value))).map((key) =>
      mismatch(key, "提示词 — only the compound `System Prompt` may stay Latin"),
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * Guard for the `skill` concept, which the 144 round's skill-detail track scan
 * found the two bundles spelling two ways: this one had 技能 on 62 keys — every
 * `skills.*` surface plus the agent skills tab it is reached from — while
 * packages/views kept the lowercase English word the voice guide mandates.
 *
 * The guide settles the direction rather than leaving it to taste: "`skill`
 * keeps lowercase English in Chinese text — a Multica-specific concept with no
 * established Chinese term; titles may capitalize as `Skills`". The Chinese docs
 * back it (475 `skill` to 1 技能), and this bundle already follows the same rule
 * for `task`, the other Multica-specific term.
 *
 * Derived from the source bundle: if the English names a skill, the Chinese
 * keeps the Latin token. Two keys elide the noun because the screen or the toast
 * already scopes it — the same "dropped, never swapped" pattern the concept
 * guard above uses.
 */
const SKILL_ELIDED_KEYS = [
  "skills.detail.refreshFailed", // "Failed to update skill" — toast on the skill page
  "skills.editor.saved", // "Skill file saved" — toast inside the skill editor
];

describe("zh glossary: the skill concept stays lowercase English", () => {
  it("keeps the Latin token wherever the English source names a skill", () => {
    const offenders = keys
      .filter((key) => /\bskills?\b/i.test(en[key] ?? ""))
      .filter((key) => !SKILL_ELIDED_KEYS.includes(key))
      .filter((key) => !/\bskills?\b/i.test(zh[key] ?? ""))
      .map((key) => mismatch(key, "the Latin token skill/Skills"));
    expect(offenders).toEqual([]);
  });

  it("never renders the concept with a Chinese word", () => {
    // The other side of the rule: a key could keep the Latin token *and* spell
    // the concept in Chinese, which the test above would not notice. 技能 is the
    // word this bundle used before the 144 round.
    const offenders = withValue((value) => value.includes("技能")).map((key) =>
      mismatch(key, "the Latin token skill/Skills, never a Chinese word"),
    );
    expect(offenders).toEqual([]);
  });

  it("still covers the surfaces the scan walked", () => {
    // The rule is only worth deriving while it spans the detail page the scan
    // found the leak on and the agent tab it is reached from.
    const covered = keys.filter((key) => /\bskills?\b/i.test(en[key] ?? ""));
    expect(covered.length).toBeGreaterThan(70);
    expect(covered).toContain("screen.skillDetail");
    expect(covered).toContain("agents.skills.assignedTitle");
    expect(covered).toContain("skills.detail.refreshConfirmWarning");
  });
});
