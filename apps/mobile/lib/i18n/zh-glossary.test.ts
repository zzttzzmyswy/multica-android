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
  "squads.detail.activeTask",
  "squads.instructions.description",
  "usage.dayTrendTasksTitle",
  "usage.emptyDescription",
  "usage.errors.kpiFailedLabel",
  "usage.metricTasks",
  "usage.tasksShort",
  "usage.totalRunTimeHint",
  "usage.totalTasks",
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
