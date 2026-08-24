import { describe, expect, it } from "vitest";
import type { Agent, AgentActivityBucket, AgentTask } from "@multica/core/types";
import {
  ACTIVITY_DAYS,
  buildActivityMap,
  deriveAgentActivity,
  deriveAvgDurationLast30d,
  formatDurationMs,
  summarizeActivityWindow,
  sortActiveAgentTasks,
  sortRecentAgentTasks,
  ACTIVE_TASK_STATUSES,
  CANCELLABLE_TASK_STATUSES,
} from "./agent-activity";

// All fixtures built from LOCAL calendar dates (new Date(y,m,d,...)), so the
// local-time day-flooring inside deriveAgentActivity is deterministic
// regardless of the runner's timezone.
function localIso(y: number, m: number, d: number, hh = 12, min = 0): string {
  return new Date(y, m - 1, d, hh, min).toISOString();
}

const NOW = new Date(2026, 7, 25, 14, 0).getTime(); // 2026-08-25 14:00 local

function bucket(
  agentId: string,
  date: [number, number, number],
  taskCount: number,
  failedCount = 0,
): AgentActivityBucket {
  return {
    agent_id: agentId,
    bucket_at: localIso(...date),
    task_count: taskCount,
    failed_count: failedCount,
  };
}

function agent(id: string, createdDaysAgo: number): Agent {
  return {
    id,
    name: id,
    created_at: new Date(NOW - createdDaysAgo * 86400000).toISOString(),
  } as Agent;
}

describe("deriveAgentActivity", () => {
  it("produces a 30-slot zeroed series for an absent bucket list", () => {
    const act = deriveAgentActivity([], agent("a", 30).created_at, NOW);
    expect(act.buckets).toHaveLength(ACTIVITY_DAYS);
    expect(act.buckets.every((b) => b.total === 0 && b.failed === 0)).toBe(true);
  });

  it("buckets a completion 2 days ago into slot DAYS-3 and sums same-day buckets", () => {
    const act = deriveAgentActivity(
      [
        bucket("a", [2026, 8, 23], 4, 1), // 2 days before 08-25 local
        bucket("a", [2026, 8, 23], 2), // same local day → same slot
      ],
      agent("a", 30).created_at,
      NOW,
    );
    const slot = ACTIVITY_DAYS - 3;
    expect(act.buckets[slot].total).toBe(6);
    expect(act.buckets[slot].failed).toBe(1);
    // All other slots untouched.
    expect(act.buckets[slot + 1].total).toBe(0);
    expect(act.buckets[0].total).toBe(0);
  });

  it("drops buckets older than 30 days and buckets in the future", () => {
    const act = deriveAgentActivity(
      [
        bucket("a", [2026, 6, 1], 99), // ~85 days ago → outside window
        bucket("a", [2026, 8, 26], 7), // tomorrow local → negative daysAgo
      ],
      agent("a", 30).created_at,
      NOW,
    );
    expect(act.buckets.every((b) => b.total === 0)).toBe(true);
  });

  it("ignores buckets with an unparseable bucket_at", () => {
    const act = deriveAgentActivity(
      [{ agent_id: "a", bucket_at: "not-a-date", task_count: 9, failed_count: 9 }],
      agent("a", 30).created_at,
      NOW,
    );
    expect(act.buckets.every((b) => b.total === 0)).toBe(true);
  });

  it("reports daysSinceCreated capped at 30 and floored at 0", () => {
    const old = deriveAgentActivity([], agent("a", 60).created_at, NOW);
    expect(old.daysSinceCreated).toBe(30);
    const young = deriveAgentActivity([], agent("a", 2).created_at, NOW);
    expect(young.daysSinceCreated).toBe(2);
    const today = deriveAgentActivity([], agent("a", 0).created_at, NOW);
    expect(today.daysSinceCreated).toBe(0);
  });
});

describe("buildActivityMap", () => {
  it("returns one entry per agent with per-agent buckets and zero-fill otherwise", () => {
    const a1 = agent("a1", 10);
    const a2 = agent("a2", 5);
    const map = buildActivityMap(
      [a1, a2],
      [bucket("a1", [2026, 8, 24], 3, 1)],
      NOW,
    );
    expect(map.size).toBe(2);
    const slot = ACTIVITY_DAYS - 2; // yesterday local
    expect(map.get("a1")?.buckets[slot].total).toBe(3);
    expect(map.get("a1")?.buckets[slot].failed).toBe(1);
    expect(map.get("a2")?.buckets.every((b) => b.total === 0)).toBe(true);
  });

  it("returns an empty map for an empty agent list", () => {
    expect(buildActivityMap([], [], NOW).size).toBe(0);
  });
});

describe("summarizeActivityWindow", () => {
  it("returns an empty summary echo for undefined activity", () => {
    const s = summarizeActivityWindow(undefined, 30);
    expect(s.buckets).toEqual([]);
    expect(s.totalRuns).toBe(0);
    expect(s.windowDays).toBe(30);
  });

  it("guards windowDays 0 (slice(-0) would return the whole array)", () => {
    const act = deriveAgentActivity(
      [bucket("a", [2026, 8, 24], 5)],
      agent("a", 30).created_at,
      NOW,
    );
    expect(summarizeActivityWindow(act, 0).buckets).toEqual([]);
  });

  it("takes a trailing 7-bucket window with summed tallies", () => {
    const act = deriveAgentActivity(
      [
        bucket("a", [2026, 8, 24], 4, 1), // slot DAYS-2
        bucket("a", [2026, 8, 19], 2), // slot DAYS-7
      ],
      agent("a", 30).created_at,
      NOW,
    );
    const s = summarizeActivityWindow(act, 7);
    expect(s.buckets).toHaveLength(7);
    expect(s.totalRuns).toBe(6);
    expect(s.totalFailed).toBe(1);
    expect(s.windowDays).toBe(7);
  });

  it("clamps a window larger than the series to the whole series", () => {
    const act = deriveAgentActivity([bucket("a", [2026, 8, 24], 3)], agent("a", 30).created_at, NOW);
    const s = summarizeActivityWindow(act, 90);
    expect(s.buckets).toHaveLength(ACTIVITY_DAYS);
    expect(s.totalRuns).toBe(3);
  });

  it("clamps negative window to 0", () => {
    const act = deriveAgentActivity([bucket("a", [2026, 8, 24], 3)], agent("a", 30).created_at, NOW);
    expect(summarizeActivityWindow(act, -5).buckets).toEqual([]);
  });
});

describe("deriveAvgDurationLast30d", () => {
  const fs = (start: string, end: string) => ({ started_at: start, completed_at: end });
  const task = (over: Partial<AgentTask>): AgentTask => ({ id: "t", agent_id: "a", runtime_id: "r", issue_id: "", status: "completed", priority: 0, dispatched_at: null, started_at: null, completed_at: null, result: null, error: null, created_at: "2026-08-01T00:00:00Z", ...over } as AgentTask);

  it("averages durations of terminal tasks completed within 30 days", () => {
    const base = localIso(2026, 8, 24, 10); // yesterday 10:00 local
    const t1 = task(fs(base, new Date(new Date(base).getTime() + 120_000).toISOString()));
    const t2 = task(fs(base, new Date(new Date(base).getTime() + 60_000).toISOString()));
    expect(deriveAvgDurationLast30d([t1, t2], NOW)).toBe(90_000);
  });

  it("excludes tasks completed more than 30 days ago and tasks without times", () => {
    const old = task(fs(localIso(2026, 6, 1, 10), localIso(2026, 6, 1, 10, 2)));
    const noStart = task({ started_at: null, completed_at: localIso(2026, 8, 24, 10) });
    const noEnd = task({ started_at: localIso(2026, 8, 24, 10), completed_at: null });
    expect(deriveAvgDurationLast30d([old, noStart, noEnd], NOW)).toBe(0);
  });

  it("skips zero/negative durations and returns 0 when nothing qualifies", () => {
    const dur = task(fs(localIso(2026, 8, 24, 10), localIso(2026, 8, 24, 9))); // negative
    expect(deriveAvgDurationLast30d([dur], NOW)).toBe(0);
  });
});

describe("formatDurationMs", () => {
  it("renders dash, seconds, minute+seconds and hours+minutes", () => {
    expect(formatDurationMs(0)).toBe("—");
    expect(formatDurationMs(-5)).toBe("—");
    expect(formatDurationMs(59_000)).toBe("59s");
    expect(formatDurationMs(90_000)).toBe("1m 30s");
    expect(formatDurationMs(3 * 3_600_000 + 12 * 60_000)).toBe("3h 12m");
  });

  it("renders sub-second durations as a minimum of 1s", () => {
    expect(formatDurationMs(250)).toBe("1s");
  });
});

function mkTask(over: Partial<AgentTask>): AgentTask {
  return {
    id: "t",
    agent_id: "a1",
    runtime_id: "r",
    issue_id: "",
    status: "completed",
    priority: 0,
    dispatched_at: null,
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
    created_at: "2026-08-24T00:00:00Z",
    ...over,
  } as AgentTask;
}

describe("active-task selection (Now)", () => {
  it("keeps workflow active statuses, drops chat tasks and terminal rows, sorts by rank then created_at", () => {
    const queued = mkTask({ id: "q", status: "queued", created_at: "2026-08-24T00:00:00Z" });
    const running = mkTask({ id: "r", status: "running", created_at: "2026-08-24T00:01:00Z" });
    const waiting = mkTask({ id: "w", status: "waiting_local_directory", created_at: "2026-08-24T00:02:00Z" });
    const dispatched = mkTask({ id: "d", status: "dispatched", created_at: "2026-08-24T00:03:00Z" });
    const chat = mkTask({ id: "c", status: "running", chat_session_id: "sess-1" });
    const done = mkTask({ id: "f", status: "failed" });
    const otherAgent = mkTask({ id: "o", agent_id: "a2", status: "running" });

    const out = sortActiveAgentTasks(
      [done, otherAgent, queued, running, waiting, dispatched, chat],
      "a1",
    );
    expect(out.map((t) => t.id)).toEqual(["r", "d", "w", "q"]);
  });
});

describe("recent-task selection (Recent work)", () => {
  it("keeps terminal workflow rows with completed_at, sorts by completed_at desc, drops chat", () => {
    const completed = mkTask({ id: "c1", status: "completed", completed_at: "2026-08-24T10:00:00Z" });
    const failed = mkTask({ id: "f", status: "failed", completed_at: "2026-08-24T12:00:00Z" });
    const cancelled = mkTask({ id: "x", status: "cancelled", completed_at: "2026-08-24T11:00:00Z" });
    const chat = mkTask({ id: "chat", status: "completed", completed_at: "2026-08-24T13:00:00Z", chat_session_id: "s-1" });
    const noCompleted = mkTask({ id: "nc", status: "failed", completed_at: null });
    const active = mkTask({ id: "running", status: "running", completed_at: "2026-08-24T09:00:00Z" });

    const out = sortRecentAgentTasks(
      [active, noCompleted, chat, completed, failed, cancelled],
      "a1",
    );
    expect(out.map((t) => t.id)).toEqual(["f", "x", "c1"]);
  });
});

describe("status constants", () => {
  it("active = queued/dispatched/waiting_local_directory/running", () => {
    expect(ACTIVE_TASK_STATUSES).toEqual(
      new Set(["queued", "dispatched", "waiting_local_directory", "running"]),
    );
  });
  it("cancellable = queued/dispatched/running (waiting_local_directory excluded)", () => {
    expect(CANCELLABLE_TASK_STATUSES).toEqual(
      new Set(["queued", "dispatched", "running"]),
    );
  });
});