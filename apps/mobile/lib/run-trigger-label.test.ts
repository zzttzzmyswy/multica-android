import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AgentTask, IssueWakeup } from "@multica/core/types";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Iteration 266 (MYS-2300). A run a wakeup rule started arrived on mobile as an
// ordinary run: `run-row.tsx` drew `trigger_summary ?? fallback`, and
// `trigger_summary` for a wakeup run is the RULE'S INSTRUCTION — so the row
// read like a task a person typed. The whole point of web's
// `wakeup-source-chip.tsx` is that a wakeup run says so, and names the rule's
// condition when the rule is still readable.
//
// These tests pin the precedence and the two fallbacks. The judge is always
// `task.wakeup_id`, never a string match on the summary: a summary is free
// text in whatever language the rule's author wrote.

function task(over: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "t1",
    agent_id: "a1",
    runtime_id: "r1",
    issue_id: "i1",
    status: "completed",
    priority: 0,
    dispatched_at: null,
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
    created_at: "2026-10-09T00:00:00Z",
    ...over,
  } as AgentTask;
}

function rule(over: Partial<IssueWakeup> = {}): IssueWakeup {
  return {
    id: "w1",
    issue_id: "i1",
    agent_id: "a1",
    agent_name: "Agent One",
    instruction: "check the PR",
    kind: "event",
    mode: "once",
    event_types: ["comment.created"],
    filter_agent_id: null,
    filter_task_id: null,
    interval_seconds: null,
    cron_expression: null,
    timezone: "UTC",
    next_fire_at: null,
    enabled: true,
    disabled_at: null,
    last_task_id: null,
    last_error: null,
    ...over,
  };
}

async function load() {
  return await import("./run-trigger-label");
}

async function loadI18n() {
  return await import("./i18n");
}

describe("runTriggerLabel", () => {
  let mod: Awaited<ReturnType<typeof load>>;
  let i18n: Awaited<ReturnType<typeof loadI18n>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    i18n = await import("./i18n");
    i18n.resetI18nForTests();
    i18n.setLocale("en");
    mod = await load();
  });

  const t = (id: string) => i18n.translate(id);

  it("names a wakeup run as such instead of quoting the rule's instruction", () => {
    // The instruction is what the agent was TOLD, not why it ran. On a row
    // that already shows the agent's name, quoting it reads as a second,
    // contradictory task description.
    const wakeupRun = task({
      wakeup_id: "w1",
      trigger_summary: "check the PR and merge if green",
    });
    expect(mod.runTriggerLabel(wakeupRun, t)).toBe("Triggered by wakeup");
  });

  it("keeps the stored summary for every other run", () => {
    expect(
      mod.runTriggerLabel(task({ trigger_summary: "please fix the flaky test" }), t),
    ).toBe("please fix the flaky test");
  });

  it("trims a whitespace-only summary rather than showing a blank row", () => {
    expect(mod.runTriggerLabel(task({ trigger_summary: "   " }), t)).toBe("Task");
  });

  it("falls back to the run kind when there is no summary", () => {
    expect(mod.runTriggerLabel(task({ kind: "autopilot" }), t)).toBe(
      "Autopilot run",
    );
    expect(mod.runTriggerLabel(task({ kind: "quick_create" }), t)).toBe(
      "Quick create",
    );
    expect(mod.runTriggerLabel(task({ kind: "direct" }), t)).toBe("Task");
    expect(mod.runTriggerLabel(task(), t)).toBe("Task");
  });

  it("does not treat the WORD wakeup in a summary as a wakeup run", () => {
    // A member can type anything. Only the field decides.
    expect(
      mod.runTriggerLabel(task({ trigger_summary: "wakeup: retry the build" }), t),
    ).toBe("wakeup: retry the build");
  });
});

describe("wakeupRunLabel", () => {
  let mod: Awaited<ReturnType<typeof load>>;
  let presentation: Awaited<typeof import("./wakeup-presentation")>;
  let i18n: Awaited<ReturnType<typeof loadI18n>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    i18n = await import("./i18n");
    i18n.resetI18nForTests();
    i18n.setLocale("en");
    mod = await load();
    presentation = await import("./wakeup-presentation");
  });

  const deps = () => ({
    t: (id: string, params?: Record<string, string | number>) =>
      i18n.translate(id, params),
    locale: i18n.getIntlLocale(),
  });
  const FALLBACK = "Triggered by wakeup";

  it("upgrades the label with the rule's condition when the rule is readable", () => {
    const label = mod.wakeupRunLabel(
      deps(),
      rule({ condition: { type: "pull_request", event: "checks_finished" } }),
      FALLBACK,
    );
    // Reuses `wakeup-presentation`'s sentence, so the same rule reads the same
    // way here and in the wakeup section above the row.
    expect(label).toBe(
      `Wakeup · ${presentation.wakeupTrigger(deps(), rule({ condition: { type: "pull_request", event: "checks_finished" } }))}`,
    );
    expect(label).not.toContain("{{condition}}");
    expect(label.length).toBeGreaterThan("Wakeup · ".length);
  });

  it("falls back whole when the rule is gone, never half a sentence", () => {
    // Runs outlive rules: deleting a rule leaves its runs behind, and a
    // template with an empty condition renders "Wakeup · " — a sentence with
    // its object missing, which reads as a rendering fault.
    expect(mod.wakeupRunLabel(deps(), undefined, FALLBACK)).toBe(FALLBACK);
  });

  it("falls back whole while the rule read is still pending too", () => {
    // Web's `useRunWakeup` returns `undefined` for pending and for a deleted
    // rule alike; both must produce the same, complete text. Claiming "not a
    // wakeup run" would be the fail-open mistake — the fallback still says a
    // wakeup triggered it, it just cannot name the condition yet.
    expect(mod.wakeupRunLabel(deps(), undefined, "Triggered by wakeup")).toBe(
      "Triggered by wakeup",
    );
  });

  it("describes an event rule by its event, not by an empty condition", () => {
    const label = mod.wakeupRunLabel(
      deps(),
      rule({ kind: "event", event_types: ["comment.created"] }),
      FALLBACK,
    );
    expect(label.startsWith("Wakeup · ")).toBe(true);
    expect(label).not.toBe("Wakeup · ");
  });

  it("describes an interval rule by its period", () => {
    const label = mod.wakeupRunLabel(
      deps(),
      rule({ kind: "every", event_types: [], interval_seconds: 3600 }),
      FALLBACK,
    );
    expect(label).toBe(`Wakeup · ${i18n.translate("wakeups.hourly")}`);
  });
});
