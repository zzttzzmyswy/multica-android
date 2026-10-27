// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { WakeupCondition, WakeupPreview } from "@multica/core/types";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

/**
 * Iteration 274 (MYS-2349) — the `pull_request` wakeup condition's third event.
 *
 * Upstream MUL-8135 extended the condition to
 * `checks_finished | merged | conflicts` and the live server enforces the same
 * three. Mobile forked at two, and the description was a binary ternary
 * (`event === "merged" ? prMerged : prChecks`), so a rule the user created on
 * web to watch for merge conflicts read back on the phone as "waiting for CI" —
 * a false statement about which signal would wake them. The create form could
 * not express the rule at all.
 *
 * These tests pin the three things a markup guard cannot see: which sentences
 * each event maps to, that an UNKNOWN event is not mapped onto one of the
 * three, and that the form's option list IS the draft's accepted union.
 */

const APP_ROOT = path.resolve(__dirname, "..");

/** Source with comments stripped, so a comment that merely names a key cannot
 *  satisfy an assertion about code. */
function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const EN = JSON.parse(
  readFileSync(path.join(APP_ROOT, "lib/i18n/locales/en.json"), "utf8"),
) as Record<string, string>;
const ZH = JSON.parse(
  readFileSync(path.join(APP_ROOT, "lib/i18n/locales/zh.json"), "utf8"),
) as Record<string, string>;

/** A `t` that records the ids it was asked for, so the test can pin WHICH key
 *  a sentence came from rather than only that some string came back. */
function recordingT() {
  const asked: string[] = [];
  const t = (id: string, params?: Record<string, string | number>) => {
    asked.push(id);
    const template = EN[id];
    if (template === undefined) return id;
    return Object.entries(params ?? {}).reduce(
      (out, [k, v]) => out.replaceAll(`{{${k}}}`, String(v)),
      template,
    );
  };
  return { t, asked };
}

function prRule(event: string): WakeupPreview {
  return {
    id: "w1",
    issue_id: "i1",
    agent_id: "a1",
    agent_name: "Agent One",
    kind: "event",
    mode: "once",
    event_types: [],
    filter_task_id: null,
    filter_agent_name: null,
    filter_actor_type: null,
    filter_actor_id: null,
    filter_actor_name: null,
    interval_seconds: null,
    cron_expression: null,
    timezone: "UTC",
    next_fire_at: null,
    condition: { type: "pull_request", event } as WakeupCondition,
  };
}

describe("the pull_request condition knows three events", () => {
  it("offers exactly the events the server accepts", async () => {
    const { WAKEUP_PR_EVENTS } = await import("./wakeup-draft");
    // The live server's own message is "event must be checks_finished, merged
    // or conflicts"; anything else is a 400 the form would have invited.
    expect([...WAKEUP_PR_EVENTS]).toEqual([
      "checks_finished",
      "merged",
      "conflicts",
    ]);
  });

  it("labels each event with its own create-form string", async () => {
    const { WAKEUP_PR_EVENT_LABEL_KEY, WAKEUP_PR_EVENTS } = await import(
      "./wakeup-draft"
    );
    const labels = WAKEUP_PR_EVENTS.map((e) => WAKEUP_PR_EVENT_LABEL_KEY[e]);
    // Distinct: a shared label is how `conflicts` got called "CI finishes".
    expect(new Set(labels).size).toBe(WAKEUP_PR_EVENTS.length);
    for (const label of labels) {
      expect(EN[label], `missing en ${label}`).toBeTruthy();
      expect(ZH[label], `missing zh ${label}`).toBeTruthy();
    }
  });

  it("builds a conflicts rule as a conflicts condition, not as CI", async () => {
    const { buildWakeupInput, emptyWakeupDraft } = await import(
      "./wakeup-draft"
    );
    const draft = {
      ...emptyWakeupDraft("a1", "UTC"),
      condition: "pull_request" as const,
      prEvent: "conflicts" as const,
      instruction: "check the conflict",
    };
    const result = buildWakeupInput(draft);
    expect("input" in result).toBe(true);
    if (!("input" in result)) throw new Error("unreachable");
    expect(result.input.condition).toEqual({
      type: "pull_request",
      event: "conflicts",
    });
    // The server refuses a condition beside raw events, so the union has to
    // stay one or the other.
    expect(result.input.event_types).toBeUndefined();
  });

  it("describes each event with its own sentence", async () => {
    const { wakeupTrigger } = await import("./wakeup-presentation");
    const seen = new Map<string, string>();
    for (const event of ["checks_finished", "merged", "conflicts"]) {
      const { t, asked } = recordingT();
      const sentence = wakeupTrigger({ t, locale: "en-US" }, prRule(event));
      expect(sentence).not.toBe(event);
      const key = asked.find((id) => id.startsWith("wakeups.cond.pr"));
      expect(key, `no pr sentence key for ${event}`).toBeTruthy();
      seen.set(event, key!);
    }
    // All three distinct, which the binary ternary could not produce.
    expect(new Set(seen.values()).size).toBe(3);
    expect(seen.get("conflicts")).toBe("wakeups.cond.prConflicts");
  });

  it("never describes a conflicts rule as waiting for CI", async () => {
    const { wakeupTrigger, wakeupWaitingText } = await import(
      "./wakeup-presentation"
    );
    const { t } = recordingT();
    const rule = wakeupTrigger({ t, locale: "en-US" }, prRule("conflicts"));
    const waiting = wakeupWaitingText({ t, locale: "en-US" }, prRule("conflicts"));
    // The exact regression: both used to fall into the `prChecks` branch.
    expect(rule).toBe(EN["wakeups.cond.prConflicts"]);
    expect(rule).not.toBe(EN["wakeups.cond.prChecks"]);
    expect(waiting).not.toBe(EN["wakeups.wait.prChecks"]);
  });

  it("does not map an event it does not know onto one it does", async () => {
    const { wakeupTrigger } = await import("./wakeup-presentation");
    const { t } = recordingT();
    // A newer server could add a fourth event. Saying "waiting for CI" about
    // it would be the same class of false statement, so the neutral sentence
    // is the only honest answer.
    const sentence = wakeupTrigger({ t, locale: "en-US" }, prRule("reopened"));
    expect(sentence).not.toBe(EN["wakeups.cond.prChecks"]);
    expect(sentence).not.toBe(EN["wakeups.cond.prMerged"]);
    expect(sentence).not.toBe(EN["wakeups.cond.prConflicts"]);
    expect(sentence).toBe(EN["wakeups.cond.prUnknown"]);
  });

  it("resolves every sentence key in both bundles", () => {
    // Hand-written key lists are how locale holes appear; derive them from the
    // site that names them instead.
    for (const K of ["wakeups.cond", "wakeups.wait"]) {
      for (const suffix of ["prChecks", "prMerged", "prConflicts", "prUnknown"]) {
        const id = `${K}.${suffix}`;
        expect(EN[id], `missing en ${id}`).toBeTruthy();
        expect(ZH[id], `missing zh ${id}`).toBeTruthy();
      }
    }
  });
});

describe("the create form's PR picker is driven by the union", () => {
  const sheet = code("components/issue/wakeup-create-sheet.tsx");

  it("renders its options from WAKEUP_PR_EVENTS", () => {
    // A hand-written two-item array is exactly how the third event stayed
    // unreachable on the phone.
    expect(sheet).toContain("WAKEUP_PR_EVENTS.map(");
    expect(sheet).toContain("WAKEUP_PR_EVENT_LABEL_KEY[event]");
  });

  it("no longer picks the pill label with a binary ternary", () => {
    // The old `draft.prEvent === "merged" ? pr_merged : pr_checks` labelled
    // every other value as "CI finishes".
    expect(sheet).not.toMatch(/prEvent === "merged"/);
    expect(sheet).toContain("WAKEUP_PR_EVENT_LABEL_KEY[draft.prEvent]");
  });
});

describe("the core condition type carries the third event", () => {
  it("admits conflicts for pull_request", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../../../packages/core/types/issue-wakeup.ts"),
      "utf8",
    );
    expect(src).toContain(
      `{ type: "pull_request"; event: "checks_finished" | "merged" | "conflicts" }`,
    );
  });
});

describe("a conflicts rule is only offered where it can fire", () => {
  /**
   * The precondition is the server's, not this client's invention:
   * `issue_wakeup_condition.go` evaluates `conflicts` only against GitHub
   * snapshot rows and answers `errPRConflictsUnsupported` when the issue's
   * linked PRs are all self-hosted. The server ACCEPTS such a rule at create
   * time, so a user who builds one gets a stored rule that can never fire —
   * silence, not an error. The form has to say so first.
   */
  it("blocks only when PRs are linked and none of them is GitHub", async () => {
    const { prConflictsReadiness } = await import("./wakeup-draft");
    expect(
      prConflictsReadiness([{ provider: "forgejo" }, { provider: "gitlab" }]),
    ).toBe("blocked");
    // A mixed set still has a GitHub PR, so the rule can fire on it.
    expect(prConflictsReadiness([{ provider: "gitea" }, { provider: "github" }])).toBe(
      "ready",
    );
    expect(prConflictsReadiness([{ provider: "github" }])).toBe("ready");
  });

  it("treats an absent provider as GitHub, the legacy backends' shape", () => {
    // Older GitHub-only backends omit `provider` entirely; reading absence as
    // "not GitHub" would warn on exactly the issues the rule DOES work for.
    return import("./wakeup-draft").then(({ prConflictsReadiness }) => {
      expect(prConflictsReadiness([{}])).toBe("ready");
      expect(prConflictsReadiness([{ provider: null }])).toBe("ready");
    });
  });

  it("stays silent with no list, or with an empty one", async () => {
    // Load-bearing: `listIssuePullRequests` degrades a failed read to
    // `{ pull_requests: [] }`, which is indistinguishable from "no PR linked
    // yet" — and "no PR linked yet" is not a reason to warn, because linking
    // one later makes the rule live. Both must therefore NOT claim the rule is
    // dead.
    const { prConflictsReadiness } = await import("./wakeup-draft");
    expect(prConflictsReadiness(undefined)).toBe("unknown");
    expect(prConflictsReadiness(null)).toBe("unknown");
    expect(prConflictsReadiness([])).toBe("unknown");
  });

  it("reads the issue's linked PRs, and only while conflicts is drafted", () => {
    // Two failures this pins at once: a form that never reads the list cannot
    // warn at all, and one that always reads it re-fetches a list the issue
    // page already holds on every unrelated draft.
    const sheet = code("components/issue/wakeup-create-sheet.tsx");
    expect(sheet).toContain("issuePullRequestsOptions(issueId)");
    expect(sheet).toContain("enabled: watchingConflicts");
    // The gate must be BOTH halves of the choice: `condition === "pull_request"`
    // alone leaves the read on for `checks_finished`/`merged` drafts, whose
    // rules have no such precondition.
    expect(sheet).toMatch(
      /draft\.condition === "pull_request" &&\s*\n?\s*draft\.prEvent === "conflicts"/,
    );
    expect(sheet).toContain("prConflictsReadiness(linkedPrs)");
  });

  it("shows the warning only on `blocked`, never on `unknown`", () => {
    const sheet = code("components/issue/wakeup-create-sheet.tsx");
    expect(sheet).toContain('conflictsReadiness === "blocked"');
    // The reverse assertion matters more: rendering on `!== "ready"` would
    // warn during the read that has not landed yet, i.e. on every conflicts
    // draft for a moment, including the ones that are fine.
    expect(sheet).not.toMatch(/conflictsReadiness !== "ready"/);
    expect(sheet).not.toMatch(/conflictsReadiness !== "unknown"/);
  });

  it("resolves the warning copy in both bundles", () => {
    for (const bundle of [EN, ZH]) {
      const text = bundle["wakeups.create.pr_conflicts_unsupported"];
      expect(text).toBeTruthy();
      // It has to name the reason, not just say "unsupported": the user's only
      // actionable fact is WHICH providers the rule cannot see.
      expect(text).toMatch(/GitHub/);
    }
    // zh must not slip to the 问题 spelling for the issue entity (glossary).
    expect(ZH["wakeups.create.pr_conflicts_unsupported"]).toContain("此任务");
  });
});

