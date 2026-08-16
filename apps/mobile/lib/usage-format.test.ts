import { describe, expect, it } from "vitest";
import {
  activeAgentCount,
  aggregateByAgent,
  aggregateDailyTokens,
  computeDailyTotals,
  DELETED_AGENTS_ROW_ID,
  formatTokens,
  isSyntheticAgentRow,
  RESTRICTED_AGENTS_ROW_ID,
} from "./usage-format";
import type { AgentUsageRow } from "./usage-format";

describe("formatTokens", () => {
  it("renders units as digits", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_200)).toBe("1.2K");
    expect(formatTokens(3_333_333)).toBe("3.3M");
    expect(formatTokens(84_630_903)).toBe("84.6M");
    expect(formatTokens(2_100_000_000)).toBe("2.1B");
  });

  it("promotes values that round across a unit boundary", () => {
    expect(formatTokens(999_999)).toBe("1M");
    expect(formatTokens(999_999_999)).toBe("1B");
  });

  it("keeps sub-K values with locale separators", () => {
    expect(formatTokens(123_456)).toBe("123.5K");
    expect(formatTokens(1500)).toBe("1.5K");
  });

  it("degrades non-finite input to 0", () => {
    expect(formatTokens(Number.NaN)).toBe("0");
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("aggregateDailyTokens", () => {
  const rows = [
    { date: "2026-08-16", provider: "p", model: "m", input_tokens: 100, output_tokens: 10, cache_read_tokens: 50, cache_write_tokens: 0, task_count: 2 },
    { date: "2026-08-16", provider: "p", model: "m2", input_tokens: 200, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 5, task_count: 1 },
    { date: "2026-08-15", provider: "p", model: "m", input_tokens: 10, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, task_count: 3 },
  ] as const;

  it("folds per-(date, model) rows into one per date ascending", () => {
    const out = aggregateDailyTokens(rows as unknown as Parameters<typeof aggregateDailyTokens>[0]);
    expect(out.map((d) => d.date)).toEqual(["2026-08-15", "2026-08-16"]);
    const d16 = out[1]!;
    expect(d16.input).toBe(300);
    expect(d16.output).toBe(30);
    expect(d16.cacheRead).toBe(50);
    expect(d16.cacheWrite).toBe(5);
    expect(d16.total).toBe(385);
  });

  it("labels dates with local month/day", () => {
    const out = aggregateDailyTokens(rows as unknown as Parameters<typeof aggregateDailyTokens>[0]);
    expect(out[0]!.label).toMatch(/^\d{1,2}\/\d{1,2}$/);
  });

  it("returns [] for empty input", () => {
    expect(aggregateDailyTokens([])).toEqual([]);
  });
});

describe("computeDailyTotals", () => {
  it("sums tokens and task counts across rows", () => {
    const rows = [
      { input_tokens: 100, output_tokens: 10, cache_read_tokens: 50, cache_write_tokens: 5, task_count: 2 },
      { input_tokens: 200, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0, task_count: 1 },
    ] as const;
    const t = computeDailyTotals(rows as unknown as Parameters<typeof computeDailyTotals>[0]);
    expect(t).toEqual({ input: 300, output: 30, cacheRead: 50, cacheWrite: 5, total: 385, taskCount: 3 });
  });

  it("zero-totals on empty input", () => {
    expect(computeDailyTotals([])).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      taskCount: 0,
    });
  });
});

describe("aggregateByAgent", () => {
  const rows = [
    { agent_id: "a", provider: "p", model: "m", input_tokens: 100, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0, task_count: 2 },
    { agent_id: "a", provider: "p", model: "m2", input_tokens: 50, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, task_count: 1 },
    { agent_id: "b", provider: "p", model: "m", input_tokens: 1_000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, task_count: 1 },
  ] as const;

  it("folds per-(agent, model) rows into one row per agent", () => {
    const out = aggregateByAgent(rows as unknown as Parameters<typeof aggregateByAgent>[0]);
    expect(out).toHaveLength(2);
    expect(out[0]!.agentId).toBe("b");
    expect(out[0]!.tokens).toBe(1_000);
    expect(out[1]!.agentId).toBe("a");
    expect(out[1]!.tokens).toBe(165);
    expect(out[1]!.taskCount).toBe(3);
  });

  it("sorts by tokens desc", () => {
    const out = aggregateByAgent(rows as unknown as Parameters<typeof aggregateByAgent>[0]);
    expect(out[0]!.tokens).toBeGreaterThanOrEqual(out[1]!.tokens);
  });
});

describe("isSyntheticAgentRow", () => {
  it("recognises both synthetic sentinels", () => {
    expect(isSyntheticAgentRow(DELETED_AGENTS_ROW_ID)).toBe(true);
    expect(isSyntheticAgentRow(RESTRICTED_AGENTS_ROW_ID)).toBe(true);
    expect(isSyntheticAgentRow("a")).toBe(false);
  });
});

describe("activeAgentCount", () => {
  it("counts distinct agents with usage, excluding synthetic buckets", () => {
    const rows: AgentUsageRow[] = [
      { agentId: "a", tokens: 100, taskCount: 1 },
      { agentId: "b", tokens: 0, taskCount: 1 },
      { agentId: DELETED_AGENTS_ROW_ID, tokens: 40, taskCount: 2 },
      { agentId: RESTRICTED_AGENTS_ROW_ID, tokens: 7, taskCount: 1 },
    ];
    expect(activeAgentCount(rows)).toBe(1);
  });

  it("counts only rows with recorded tokens", () => {
    const rows: AgentUsageRow[] = [
      { agentId: "a", tokens: 1, taskCount: 0 },
      { agentId: "b", tokens: 0, taskCount: 5 },
    ];
    expect(activeAgentCount(rows)).toBe(1);
    expect(activeAgentCount([])).toBe(0);
  });
});