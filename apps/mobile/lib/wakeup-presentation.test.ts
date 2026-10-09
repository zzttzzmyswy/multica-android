import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AgentTask, IssueWakeup, SystemWakeup } from "@multica/core/types";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Iteration 214 (MYS-2023). The wakeup subsystem is at zero on mobile: no
// section, no header chip, and the five `wakeup_*` timeline actions render as
// bare English enum strings. These tests pin the pure decision layer that the
// UI reads, ported from web's `wakeup-presentation.ts` and
// `issue-wakeup-header-chip.tsx`.

function wakeup(over: Partial<IssueWakeup> = {}): IssueWakeup {
  return {
    id: "w1",
    issue_id: "i1",
    agent_id: "a1",
    agent_name: "Agent One",
    instruction: "do the thing",
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

function task(over: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "t1",
    agent_id: "a1",
    runtime_id: "r1",
    issue_id: "i1",
    status: "queued",
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

function systemRule(over: Partial<SystemWakeup> = {}): SystemWakeup {
  return {
    id: "sys1",
    revision: 1,
    rule: "child_done",
    enabled: true,
    instruction: "",
    default_instruction: "when children finish",
    customized: false,
    paused_reason: null,
    staged: false,
    stage: null,
    total: 3,
    remaining: 2,
    waiting: ["MYS-2"],
    target: { type: "agent", id: "a1", name: "Agent One" },
    blocked: "",
    workspace_default: true,
    ...over,
  };
}

async function load() {
  return await import("./wakeup-presentation");
}

describe("wakeupRun / isCurrentWakeup", () => {
  let mod: Awaited<ReturnType<typeof load>>;
  beforeEach(async () => {
    mod = await load();
  });

  it("matches a rule to the active run it started, by wakeup_id", () => {
    // The wire does carry `wakeup_id` (probed live: 23 such tasks in the
    // workspace), and it is the only link between a rule and its run.
    const w = wakeup({ id: "w1", last_task_id: "t-old" });
    const active = task({ id: "t-new", wakeup_id: "w1", status: "running" });
    const old = task({ id: "t-old", status: "completed" });
    expect(mod.wakeupRun(w, [old, active])?.id).toBe("t-new");
  });

  it("falls back to last_task_id when no run of the rule is still active", () => {
    const w = wakeup({ id: "w1", last_task_id: "t-old" });
    const old = task({ id: "t-old", status: "completed" });
    expect(mod.wakeupRun(w, [old])?.id).toBe("t-old");
  });

  it("treats queued/deferred/dispatched/running/waiting as active runs", () => {
    for (const status of [
      "queued",
      "deferred",
      "dispatched",
      "running",
      "waiting_local_directory",
    ]) {
      expect(mod.isActiveWakeupRun(status)).toBe(true);
    }
    for (const status of ["completed", "failed", "cancelled"]) {
      expect(mod.isActiveWakeupRun(status)).toBe(false);
    }
    expect(mod.isActiveWakeupRun(null)).toBe(false);
    expect(mod.isActiveWakeupRun(undefined)).toBe(false);
  });

  it("keeps a rule current while enabled, or while its run still runs", () => {
    expect(mod.isCurrentWakeup(wakeup({ enabled: true }))).toBe(true);
    expect(mod.isCurrentWakeup(wakeup({ enabled: false }))).toBe(false);
    // Disabled but a run is still in flight: the section must not file it
    // under "history" — the agent is still working.
    const running = task({ status: "running" });
    expect(mod.isCurrentWakeup(wakeup({ enabled: false }), running)).toBe(true);
    expect(
      mod.isCurrentWakeup(
        wakeup({ enabled: false, last_task_status: "running" }),
      ),
    ).toBe(true);
  });
});

describe("wakeupState", () => {
  let mod: Awaited<ReturnType<typeof load>>;
  beforeEach(async () => {
    mod = await load();
  });

  it("reads a closed issue as stopped regardless of the rule", () => {
    expect(mod.wakeupState(wakeup({ enabled: true }), true)).toBe(
      "issue_closed",
    );
  });

  it("distinguishes waiting-by-event from scheduled", () => {
    expect(mod.wakeupState(wakeup({ kind: "event", enabled: true }))).toBe(
      "waiting",
    );
    expect(
      mod.wakeupState(
        wakeup({ kind: "every", enabled: true, interval_seconds: 3600 }),
      ),
    ).toBe("scheduled");
  });

  it("separates the four inactive reasons", () => {
    expect(
      mod.wakeupState(wakeup({ enabled: false, paused_reason: "rate" })),
    ).toBe("paused");
    expect(
      mod.wakeupState(wakeup({ enabled: false, timed_out_at: "2026-01-01T00:00:00Z" })),
    ).toBe("timed_out");
    expect(
      mod.wakeupState(wakeup({ enabled: false, disabled_at: "2026-01-01T00:00:00Z" })),
    ).toBe("disabled");
    expect(
      mod.wakeupState(wakeup({ enabled: false, last_task_id: "t1" })),
    ).toBe("triggered");
  });

  it("reads a past `at` deadline as expired, a future one as inactive", () => {
    const now = Date.parse("2026-06-01T00:00:00Z");
    expect(
      mod.wakeupState(
        wakeup({ kind: "at", enabled: false, next_fire_at: "2026-05-01T00:00:00Z" }),
        false,
        now,
      ),
    ).toBe("expired");
    expect(
      mod.wakeupState(
        wakeup({ kind: "at", enabled: false, next_fire_at: "2026-07-01T00:00:00Z" }),
        false,
        now,
      ),
    ).toBe("inactive");
  });
});

describe("primaryWakeup (header chip selection)", () => {
  let mod: Awaited<ReturnType<typeof load>>;
  beforeEach(async () => {
    mod = await load();
  });

  it("prefers a rule waiting on an event over a scheduled one", () => {
    const eventRule = wakeup({ id: "e", kind: "event" });
    const scheduled = wakeup({
      id: "s",
      kind: "at",
      next_fire_at: "2026-10-09T01:00:00Z",
    });
    const picked = mod.primaryWakeup([scheduled, eventRule], []);
    expect(picked?.kind).toBe("rule");
    expect(picked?.rule.id).toBe("e");
  });

  it("picks the soonest scheduled rule when nothing waits on an event", () => {
    const later = wakeup({
      id: "later",
      kind: "at",
      next_fire_at: "2026-10-10T01:00:00Z",
    });
    const sooner = wakeup({
      id: "sooner",
      kind: "at",
      next_fire_at: "2026-10-09T01:00:00Z",
    });
    const picked = mod.primaryWakeup([later, sooner], []);
    expect(picked?.rule.id).toBe("sooner");
  });

  it("counts every enabled rule plus an actionable system rule", () => {
    const picked = mod.primaryWakeup(
      [wakeup({ id: "a" }), wakeup({ id: "b" })],
      [systemRule()],
    );
    expect(picked?.count).toBe(3);
  });

  it("falls back to the system rule when no rule of the issue is enabled", () => {
    const picked = mod.primaryWakeup(
      [wakeup({ enabled: false })],
      [systemRule()],
    );
    expect(picked?.kind).toBe("system");
    expect(picked?.count).toBe(1);
  });

  it("ignores a system rule that is off, blocked, or has no target", () => {
    expect(mod.primaryWakeup([], [systemRule({ enabled: false })])).toBeNull();
    expect(mod.primaryWakeup([], [systemRule({ blocked: "backlog" })])).toBeNull();
    expect(mod.primaryWakeup([], [systemRule({ target: null })])).toBeNull();
  });

  it("shows a paused rule only when nothing else is waiting, and counts it as 1", () => {
    const paused = wakeup({ enabled: false, paused_reason: "loop" });
    const picked = mod.primaryWakeup([paused], []);
    expect(picked?.kind).toBe("paused");
    expect(picked?.count).toBe(1);
    // A live rule outranks the paused one, but the paused rule is still not
    // silently dropped from the count.
    const withLive = mod.primaryWakeup([paused, wakeup({ id: "live" })], []);
    expect(withLive?.kind).toBe("rule");
    expect(withLive?.count).toBe(1);
  });

  it("returns null when the issue is waiting on nothing", () => {
    expect(mod.primaryWakeup([], [])).toBeNull();
  });
});

describe("wakeupRunStateText", () => {
  const deps = { t: (id: string, params?: Record<string, string | number>) => {
    const en: Record<string, string> = {
      "wakeups.noRun": "Not run yet",
      "wakeups.runStates.completed": "Run succeeded",
      "wakeups.runStates.failed": "Run failed",
      "wakeups.runStates.queued": "Queued",
    };
    return en[id] ?? id;
  } };

  it("names a terminal run, not an empty string", async () => {
    // The device smoke showed the trigger-history block rendering an empty
    // line for a completed run. The first version of this suite only asserted
    // truthiness, which "" satisfies halfway — so it never caught it.
    const mod = await load();
    expect(mod.wakeupRunStateText(deps, "completed")).toBe("Run succeeded");
    expect(mod.wakeupRunStateText(deps, "failed")).toBe("Run failed");
    expect(mod.wakeupRunStateText(deps, "queued")).toBe("Queued");
  });

  it("says so when a rule has never run", async () => {
    const mod = await load();
    expect(mod.wakeupRunStateText(deps, null)).toBe("Not run yet");
    expect(mod.wakeupRunStateText(deps, "")).toBe("Not run yet");
  });

  it("shows an unrecognized status verbatim rather than claiming no run", async () => {
    const mod = await load();
    expect(mod.wakeupRunStateText(deps, "something_new")).toBe("something_new");
  });
});

describe("formatWakeupTime", () => {
  it("renders a wire instant as a readable time, not the raw string", async () => {
    // The defect the device smoke caught: the section printed
    // `2026-10-12T04:04:16.978744+08:00` verbatim.
    const mod = await load();
    const out = mod.formatWakeupTime("2026-10-12T04:04:16.978744+08:00");
    expect(out).not.toContain("T04:");
    expect(out).not.toContain("978744");
    // The formatter is deliberately year-less (a rule expires within days),
    // so what must NOT survive is the machine form, not the year.
    expect(out).toMatch(/\d{1,2}:\d{2}/);
  });

  it("passes a value it cannot parse straight through", async () => {
    // Never crash and never invent a date: an unparseable value is shown as
    // it arrived, which is the module's documented fallback.
    const mod = await load();
    expect(mod.formatWakeupTime("not a date")).toBe("not a date");
  });
});

describe("isClosedIssue", () => {
  let mod: Awaited<ReturnType<typeof load>>;
  beforeEach(async () => {
    mod = await load();
  });

  it("treats done and cancelled as closed", () => {
    expect(mod.isClosedIssue({ status: "done" } as never)).toBe(true);
    expect(mod.isClosedIssue({ status: "cancelled" } as never)).toBe(true);
  });

  it("treats an in-flight status as open", () => {
    for (const status of ["todo", "in_progress", "in_review", "blocked"]) {
      expect(mod.isClosedIssue({ status } as never)).toBe(false);
    }
  });

  it("reads the category a custom status resolves to", () => {
    // A workspace status inside the done category closes the issue even though
    // its key is not the literal "done" (MUL-6243).
    expect(
      mod.isClosedIssue({
        status: "shipped",
        status_category: "done",
      } as never),
    ).toBe(true);
  });

  it("treats an unresolvable status as open, never as stopped", () => {
    // Claiming a rule has stopped when we cannot read the status is the one
    // wrong answer that would make a reader stop looking.
    expect(mod.isClosedIssue({ status: "mystery_key" } as never)).toBe(false);
    expect(mod.isClosedIssue(null)).toBe(false);
    expect(mod.isClosedIssue(undefined)).toBe(false);
  });
});

describe("WAKEUP_ACTIVITY_ACTIONS", () => {
  let mod: Awaited<ReturnType<typeof load>>;
  beforeEach(async () => {
    mod = await load();
  });

  it("names exactly the five actions the wakeup service writes", () => {
    // Guards the reverse case too: dropping one makes this fail, which is the
    // point — the formatter must cover the whole set, not most of it.
    expect([...mod.WAKEUP_ACTIVITY_ACTIONS].sort()).toEqual([
      "wakeup_checkin",
      "wakeup_created",
      "wakeup_paused",
      "wakeup_timed_out",
      "wakeup_triggered",
    ]);
  });
});
