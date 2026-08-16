import { describe, expect, it } from "vitest";
import type {
  DashboardAgentRunTime,
  DashboardRunTimeDaily,
} from "@multica/core/types";
import {
  DELETED_AGENTS_ROW_ID,
  RESTRICTED_AGENTS_ROW_ID,
  type AgentUsageRow,
} from "./usage-format";
import {
  aggregateDailyTasks,
  aggregateDailyTime,
  formatDuration,
  mergeAgentDashboardRows,
  bucketAgentDashboardRows,
} from "./usage-time";

const daily = (rows: [string, number, number, number, number][]): DashboardRunTimeDaily[] =>
  rows.map(([date, total_seconds, task_count, failed_count, cancelled_count]) => ({
    date,
    total_seconds,
    task_count,
    failed_count,
    cancelled_count,
  }));

const runTime = (
  rows: [string, number, number, number, number][],
): DashboardAgentRunTime[] =>
  rows.map(([agent_id, total_seconds, task_count, failed_count, cancelled_count]) => ({
    agent_id,
    total_seconds,
    task_count,
    failed_count,
    cancelled_count,
  }));

const token = (rows: [string, number, number][]): AgentUsageRow[] =>
  rows.map(([agentId, tokens, taskCount]) => ({ agentId, tokens, taskCount }));

describe("aggregateDailyTime", () => {
  it("maps per-date run-time rows with a label, ascending", () => {
    const rows = aggregateDailyTime(
      daily([
        ["2026-08-16", 3600, 2, 0, 0],
        ["2026-08-15", 7200, 4, 1, 0],
      ]),
    );
    expect(rows.map((r) => r.date)).toEqual(["2026-08-15", "2026-08-16"]);
    expect(rows[0]).toEqual({ date: "2026-08-15", label: "8/15", totalSeconds: 7200 });
    expect(rows[1]).toEqual({ date: "2026-08-16", label: "8/16", totalSeconds: 3600 });
  });

  it("returns [] for an empty payload", () => {
    expect(aggregateDailyTime([])).toEqual([]);
  });
});

describe("aggregateDailyTasks", () => {
  it("computes completed as the remainder after failed and cancelled", () => {
    const rows = aggregateDailyTasks(
      daily([
        ["2026-08-15", 60, 10, 3, 2],
        ["2026-08-16", 60, 5, 5, 0],
      ]),
    );
    expect(rows[0]).toMatchObject({ completed: 5, failed: 3, cancelled: 2 });
    expect(rows[1]).toMatchObject({ completed: 0, failed: 5, cancelled: 0 });
  });

  it("never lets completed go negative when counts misalign", () => {
    const rows = aggregateDailyTasks(daily([["2026-08-15", 60, 2, 3, 1]]));
    expect(rows[0]).toMatchObject({ completed: 0, failed: 3, cancelled: 1 });
  });

  it("orders dates ascending with a label", () => {
    const rows = aggregateDailyTasks(
      daily([
        ["2026-08-16", 60, 1, 0, 0],
        ["2026-08-15", 60, 1, 1, 0],
      ]),
    );
    expect(rows.map((r) => r.date)).toEqual(["2026-08-15", "2026-08-16"]);
    expect(rows[0]!.label).toBe("8/15");
  });

  it("returns [] for an empty payload", () => {
    expect(aggregateDailyTasks([])).toEqual([]);
  });
});

describe("formatDuration", () => {
  const LESS = "<1m";

  it("renders sub-second as the less-than-minute label", () => {
    expect(formatDuration(0, LESS)).toBe(LESS);
    expect(formatDuration(0.4, LESS)).toBe(LESS);
  });

  it("renders seconds alone under a minute", () => {
    expect(formatDuration(30, LESS)).toBe("30s");
    expect(formatDuration(45, LESS)).toBe("45s");
  });

  it("renders minutes and seconds, dropping the seconds when exact", () => {
    expect(formatDuration(90, LESS)).toBe("1m 30s");
    expect(formatDuration(720, LESS)).toBe("12m");
  });

  it("renders hours and minutes", () => {
    expect(formatDuration(3780, LESS)).toBe("1h 3m");
    expect(formatDuration(3600, LESS)).toBe("1h");
  });

  it("renders whole days without a fragment", () => {
    expect(formatDuration(86400, LESS)).toBe("1d");
    expect(formatDuration(90000, LESS)).toBe("1d 1h");
  });

  it("degrades negative and non-finite input to the label", () => {
    expect(formatDuration(-1, LESS)).toBe(LESS);
    expect(formatDuration(Number.NaN, LESS)).toBe(LESS);
    expect(formatDuration(Number.POSITIVE_INFINITY, LESS)).toBe(LESS);
  });
});

describe("mergeAgentDashboardRows", () => {
  it("prefers the run-time taskCount over the token rollup rollup", () => {
    const merged = mergeAgentDashboardRows(
      token([
        ["agent-a", 1000, 99], // token rollup double-counted the same task
        ["agent-b", 200, 1],
      ]),
      runTime([
        ["agent-a", 3600, 3, 1, 0],
        ["agent-b", 60, 1, 0, 0],
      ]),
    );
    const a = merged.find((r) => r.agentId === "agent-a");
    expect(a?.taskCount).toBe(3);
    expect(a?.seconds).toBe(3600);
  });

  it("keeps run-time-only agents on the list with zero tokens", () => {
    const merged = mergeAgentDashboardRows(
      token([["agent-a", 100, 2]]),
      runTime([
        ["agent-a", 60, 2, 0, 0],
        ["agent-b", 120, 1, 1, 0], // spent no tokens but did run
      ]),
    );
    const b = merged.find((r) => r.agentId === "agent-b");
    expect(b).toBeDefined();
    expect(b?.tokens).toBe(0);
    expect(b?.seconds).toBe(120);
    expect(b?.taskCount).toBe(1);
  });

  it("falls back to the token taskCount when an agent has no run-time row", () => {
    const merged = mergeAgentDashboardRows(
      token([["agent-a", 100, 4]]),
      runTime([]),
    );
    expect(merged[0]).toMatchObject({ agentId: "agent-a", tokens: 100, taskCount: 4, seconds: 0 });
  });

  it("sorts by tokens desc, tie-breaking on run time desc", () => {
    const merged = mergeAgentDashboardRows(
      token([
        ["agent-a", 500, 1],
        ["agent-b", 1000, 1],
        ["agent-c", 1000, 1],
      ]),
      runTime([
        ["agent-a", 10, 1, 0, 0],
        ["agent-b", 3600, 1, 0, 0],
        ["agent-c", 1800, 1, 0, 0],
      ]),
    );
    expect(merged.map((r) => r.agentId)).toEqual(["agent-b", "agent-c", "agent-a"]);
  });

  it("returns [] for empty inputs", () => {
    expect(mergeAgentDashboardRows([], [])).toEqual([]);
  });
});

describe("bucketAgentDashboardRows", () => {
  it("passes rows through untouched while the agent list is loading", () => {
    const rows = mergeAgentDashboardRows(
      token([["x", 1, 0]]),
      runTime([]),
    );
    expect(bucketAgentDashboardRows(rows, null)).toEqual(rows);
  });

  it("folds unknown agents into the deleted bucket, keeping spend visible", () => {
    const rows = mergeAgentDashboardRows(
      token([
        ["a", 100, 1],
        ["nope", 50, 2],
        ["b", 30, 1],
      ]),
      runTime([
        ["a", 60, 1, 0, 0],
        ["b", 60, 1, 0, 0],
      ]),
    );
    const out = bucketAgentDashboardRows(rows, new Set(["a", "b"]));
    const bucket = out.find((r) => r.agentId === DELETED_AGENTS_ROW_ID);
    expect(bucket?.tokens).toBe(50);
    // Deleted agents never contributed to the run-time rollups (they inner-join
    // the agent table), so the bucket carries no seconds or tasks (web parity).
    expect(bucket?.seconds).toBe(0);
    expect(bucket?.taskCount).toBe(0);
  });

  it("keeps the server restricted bucket as itself, not folded into deleted", () => {
    const rows = mergeAgentDashboardRows(
      token([
        [RESTRICTED_AGENTS_ROW_ID, 7, 1],
        ["a", 3, 0],
      ]),
      runTime([
        [RESTRICTED_AGENTS_ROW_ID, 120, 1, 0, 0],
        ["a", 60, 0, 0, 0],
      ]),
    );
    const out = bucketAgentDashboardRows(rows, new Set(["a"]));
    expect(out.some((r) => r.agentId === DELETED_AGENTS_ROW_ID)).toBe(false);
    const restricted = out.find((r) => r.agentId === RESTRICTED_AGENTS_ROW_ID);
    expect(restricted?.seconds).toBe(120);
  });
});