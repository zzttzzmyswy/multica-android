import { describe, expect, it } from "vitest";
import type { DashboardFailureByAgent, DashboardFailureDaily } from "@multica/core/types";
import { FAILURE_CLASSES } from "./failure-class";
import {
  aggregateAgentFailures,
  aggregateDailyErrors,
  aggregateFailureClasses,
  aggregateFailureReasons,
  aggregateWeeklyErrors,
  computeFailureTotals,
  failureClassColors,
  formatRate,
  hasRateSample,
  isUnresolvedAgentRow,
  MIN_RATE_SAMPLE,
  OFFENDER_METRIC,
  parseHsl,
  sortAgentFailures,
  UNRESOLVED_AGENTS_ROW_ID,
} from "./usage-errors";

const daily = (rows: [string, string, number][]): DashboardFailureDaily[] =>
  rows.map(([date, failure_reason, task_count]) => ({ date, failure_reason, task_count }));

const byAgent = (rows: [string, string, number][]): DashboardFailureByAgent[] =>
  rows.map(([agent_id, failure_reason, task_count]) => ({ agent_id, failure_reason, task_count }));

describe("computeFailureTotals", () => {
  it("counts failures vs all terminal tasks, empty reason is the succeeded bucket", () => {
    const totals = computeFailureTotals(
      daily([
        ["2026-08-15", "", 10],
        ["2026-08-15", "timeout", 2],
        ["2026-08-16", "agent_error.process_failure", 3],
      ]),
    );
    expect(totals.failed).toBe(5);
    expect(totals.total).toBe(15);
    expect(totals.rate).toBeCloseTo(5 / 15);
  });

  it("returns zero rate for an empty window", () => {
    expect(computeFailureTotals([])).toEqual({ failed: 0, total: 0, rate: 0 });
  });
});

describe("aggregateDailyErrors", () => {
  it("folds per-(date, reason) rows into one row per date, ascending", () => {
    const rows = aggregateDailyErrors(
      daily([
        ["2026-08-16", "timeout", 2],
        ["2026-08-15", "", 10],
        ["2026-08-15", "agent_error.process_failure", 3],
        ["2026-08-16", "", 4],
      ]),
    );
    expect(rows.map((r) => r.date)).toEqual(["2026-08-15", "2026-08-16"]);
    expect(rows[0]).toMatchObject({ failed: 3, total: 13 });
    expect(rows[1]).toMatchObject({ failed: 2, total: 6 });
    expect(rows[0]!.timeout).toBe(0);
    expect(rows[1]!.timeout).toBe(2);
  });

  it("produces a short label for each date", () => {
    const rows = aggregateDailyErrors(daily([["2026-08-15", "timeout", 1]]));
    expect(rows[0]!.label).toBe("8/15");
  });

  it("returns [] for an empty payload", () => {
    expect(aggregateDailyErrors([])).toEqual([]);
  });
});

describe("aggregateWeeklyErrors", () => {
  it("buckets rows into Mon–Sun weeks, ascending", () => {
    // 2026-08-17 is a Monday.
    const rows = aggregateWeeklyErrors(
      daily([
        ["2026-08-17", "timeout", 2], // Monday
        ["2026-08-23", "", 5], // Sunday, same week
        ["2026-08-10", "runtime_offline", 1], // previous Monday
        ["2026-08-24", "agent_error.unknown", 4], // next Monday
      ]),
    );
    expect(rows.map((r) => r.weekStart)).toEqual(["2026-08-10", "2026-08-17", "2026-08-24"]);
    expect(rows[1]).toMatchObject({ failed: 2, total: 7 });
    expect(rows[1]!.runtime).toBe(0);
  });
});

describe("aggregateFailureClasses", () => {
  it("sums per-class counts, heaviest first, zero-count classes dropped", () => {
    const rows = aggregateFailureClasses(
      daily([
        ["2026-08-15", "agent_error.process_failure", 3],
        ["2026-08-15", "timeout", 2],
        ["2026-08-15", "", 10],
        ["2026-08-15", "some_future_reason", 1],
      ]),
    );
    expect(rows.map((r) => r.failureClass)).toEqual(["agent", "timeout", "other"]);
    expect(rows.map((r) => r.count)).toEqual([3, 2, 1]);
  });

  it("breaks ties on FAILURE_CLASSES order", () => {
    const rows = aggregateFailureClasses(
      daily([
        ["2026-08-15", "runtime_offline", 1],
        ["2026-08-15", "timeout", 1],
      ]),
    );
    // timeout (index 2) sorts before runtime (index 4).
    expect(rows.map((r) => r.failureClass)).toEqual(["timeout", "runtime"]);
  });
});

describe("aggregateFailureReasons", () => {
  it("answers which specific error, heaviest first, then reason asc", () => {
    const rows = aggregateFailureReasons(
      daily([
        ["2026-08-15", "timeout", 2],
        ["2026-08-15", "timeout", 1],
        ["2026-08-15", "runtime_offline", 1],
        ["2026-08-15", "", 10],
      ]),
    );
    expect(rows).toEqual([
      { reason: "timeout", failureClass: "timeout", count: 3 },
      { reason: "runtime_offline", failureClass: "runtime", count: 1 },
    ]);
  });
});

describe("aggregateAgentFailures", () => {
  it("folds per-agent rows, default sorted by absolute failure count", () => {
    const rows = aggregateAgentFailures(
      byAgent([
        ["agent-1", "timeout", 2],
        ["agent-1", "", 5],
        ["agent-2", "agent_error.process_failure", 1],
      ]),
    );
    expect(rows.map((r) => r.agentId)).toEqual(["agent-1", "agent-2"]);
    expect(rows[0]).toMatchObject({ agentId: "agent-1", failed: 2, total: 7, rate: 2 / 7 });
    expect(rows[0]!.classes.timeout).toBe(2);
  });

  it("drops agents with zero failures", () => {
    const rows = aggregateAgentFailures(byAgent([["agent-1", "", 5]]));
    expect(rows).toEqual([]);
  });

  it("folds unknown agents into one UNRESOLVED bucket when agents are supplied", () => {
    const rows = aggregateAgentFailures(
      byAgent([
        ["agent-1", "timeout", 2],
        ["gone-agent", "runtime_offline", 1],
        ["__restricted_agents__", "agent_error.unknown", 4],
      ]),
      [{ id: "agent-1" }],
    );
    expect(rows.map((r) => r.agentId)).toEqual([UNRESOLVED_AGENTS_ROW_ID, "agent-1"]);
    const bucket = rows.find((r) => r.agentId === UNRESOLVED_AGENTS_ROW_ID)!;
    expect(bucket.failed).toBe(5);
  });

  it("leaves rows untouched when the agent list is not supplied", () => {
    const raw = byAgent([["unknown-agent", "timeout", 2]]);
    const rows = aggregateAgentFailures(raw);
    expect(rows[0]!.agentId).toBe("unknown-agent");
  });

  it("sorts by absolute count by default so 40 failures outrank a 100% one-off", () => {
    const rows = aggregateAgentFailures(
      byAgent([
        ["one-shot", "timeout", 1], // 1/1 = 100%
        ["repeater", "timeout", 40],
        ["repeater", "", 60],
      ]),
    );
    expect(rows.map((r) => r.agentId)).toEqual(["repeater", "one-shot"]);
  });
});

describe("sortAgentFailures", () => {
  const rows = () => [
    { agentId: "a", failed: 1, total: 1, rate: 1, classes: {} as never },
    { agentId: "b", failed: 40, total: 100, rate: 0.4, classes: {} as never },
    { agentId: "c", failed: 5, total: 50, rate: 0.1, classes: {} as never },
    { agentId: "d", failed: 4, total: 20, rate: 0.2, classes: {} as never },
  ];

  it("ranks by absolute failures when sortBy = failed", () => {
    expect(sortAgentFailures(rows(), "failed").map((r) => r.agentId)).toEqual([
      "b", "c", "d", "a",
    ]);
  });

  it("demotes small samples under Rate, then ranks by rate desc", () => {
    // a (1 run, no sample) ranks last; the sampled rows rank by rate desc.
    const r = rows();
    expect(sortAgentFailures(r, "rate").map((x) => x.agentId)).toEqual(["b", "d", "c", "a"]);
  });

  it("breaks failed ties on rate, and rate ties on failed count", () => {
    const tied = [
      { agentId: "x", failed: 3, total: 10, rate: 0.3, classes: {} as never },
      { agentId: "y", failed: 3, total: 6, rate: 0.5, classes: {} as never },
    ];
    expect(sortAgentFailures(tied, "failed").map((r) => r.agentId)).toEqual(["y", "x"]);
  });

  it("exposes the sort contract constants", () => {
    expect(MIN_RATE_SAMPLE).toBe(10);
    expect(OFFENDER_METRIC.failed({ failed: 7 } as never)).toBe(7);
    expect(OFFENDER_METRIC.rate({ rate: 0.25 } as never)).toBe(0.25);
    expect(hasRateSample({ total: 10 } as never)).toBe(true);
    expect(hasRateSample({ total: 9 } as never)).toBe(false);
  });
});

describe("formatRate", () => {
  it("rounds rates >= 10%, keeps one decimal below it (web parity)", () => {
    expect(formatRate(4, 10)).toBe("40%");
    // The ×100 scale leaves a float residue (1.0000000000000002), so sub-10%
    // whole percentages still render with one decimal — identical to web.
    expect(formatRate(1, 100)).toBe("1.0%");
    expect(formatRate(1, 74)).toBe("1.4%");
    expect(formatRate(0, 10)).toBe("0%");
  });

  it("renders a dash for a window with no terminal tasks", () => {
    expect(formatRate(0, 0)).toBe("—");
  });
});

describe("failure class colours", () => {
  it("parses the THEME hsl format", () => {
    expect(parseHsl("hsl(0 84.2% 60.2%)")).toEqual({ h: 0, s: 84.2, l: 60.2 });
    expect(parseHsl("nope")).toBeNull();
  });

  it("returns one colour per class, keyed by every class", () => {
    const colors = failureClassColors("hsl(0 84.2% 60.2%)", "hsl(0 0% 100%)");
    expect(Object.keys(colors).sort()).toEqual([...FAILURE_CLASSES].sort());
  });

  it("renders auth darkest (full destructive) and other lightest", () => {
    const light = failureClassColors("hsl(0 84.2% 60.2%)", "hsl(0 0% 100%)");
    expect(light.auth).toBe("hsl(0 84.2% 60.2%)");
    // other mixes the largest share of card, so its lightness is closest to card.
    const { l: authL } = parseHsl(light.auth)!;
    const { l: otherL } = parseHsl(light.other)!;
    const { l: cardL } = parseHsl("hsl(0 0% 100%)")!;
    expect(Math.abs(otherL - cardL)).toBeLessThan(Math.abs(authL - cardL));
  });

  it("falls back to destructive for unparseable inputs", () => {
    const colors = failureClassColors("bad", "also-bad");
    expect(colors.auth).toBe("bad");
    expect(colors.other).toBe("bad");
  });

  it("recognises the unresolved bucket", () => {
    expect(isUnresolvedAgentRow(UNRESOLVED_AGENTS_ROW_ID)).toBe(true);
    expect(isUnresolvedAgentRow("agent-1")).toBe(false);
  });
});