import { describe, expect, it } from "vitest";
import {
  activeAgentCount,
  aggregateByAgent,
  aggregateDailyCost,
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
    expect(t).toEqual({
      input: 300,
      output: 30,
      cacheRead: 50,
      cacheWrite: 5,
      total: 385,
      taskCount: 3,
      cost: 0,
    });
  });

  it("zero-totals on empty input", () => {
    expect(computeDailyTotals([])).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      taskCount: 0,
      cost: 0,
    });
  });

  it("sums estimated cost from the rate table (claude-sonnet-5)", () => {
    const rows = [
      { date: "2026-08-16", provider: "anthropic", model: "claude-sonnet-5", input_tokens: 1_000_000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, task_count: 1 },
      { date: "2026-08-16", provider: "anthropic", model: "claude-sonnet-5", input_tokens: 0, output_tokens: 100_000, cache_read_tokens: 1_000_000, cache_write_tokens: 200_000, task_count: 1 },
    ] as const;
    const t = computeDailyTotals(rows as unknown as Parameters<typeof computeDailyTotals>[0]);
    // 1M in @ $2/1M + 100k out @ $10/1M + 1M cache-read @ $0.20/1M + 200k cache-write @ $2.50/1M
    expect(t.cost).toBeCloseTo(3.7, 10);
  });

  it("adds authoritative cost to the estimated part", () => {
    const rows = [
      { date: "2026-08-16", provider: "anthropic", model: "claude-sonnet-5", input_tokens: 500_000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd_ticks: 5_000_000_000, uncosted_input_tokens: 500_000, uncosted_output_tokens: 0, uncosted_cache_read_tokens: 0, uncosted_cache_write_tokens: 0, task_count: 1 },
    ] as const;
    const t = computeDailyTotals(rows as unknown as Parameters<typeof computeDailyTotals>[0]);
    // $0.50 authoritative (5e9 ticks) + 500k in @ $2/1M = $1.00
    expect(t.cost).toBeCloseTo(1.5, 10);
  });
});

describe("aggregateDailyCost", () => {
  it("folds per-(date, model) rows into one dated cost stack, ascending", () => {
    const rows = [
      { date: "2026-08-16", provider: "anthropic", model: "claude-sonnet-5", input_tokens: 500_000, output_tokens: 100_000, cache_read_tokens: 0, cache_write_tokens: 200_000, task_count: 1 },
      { date: "2026-08-16", provider: "x", model: "no-such-model", input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd_ticks: 30_000_000_000, task_count: 1 },
      { date: "2026-08-15", provider: "anthropic", model: "claude-sonnet-5", input_tokens: 1_000_000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, task_count: 1 },
    ] as const;
    const out = aggregateDailyCost(rows as unknown as Parameters<typeof aggregateDailyCost>[0]);
    // 08-16: estimated {in: $1, out: $1, cacheWrite: $0.50} + unpriced row's
    // authoritative $3 lands whole in the input stack → {in: 4, out: 1, cw: 0.5}
    expect(out.map((d) => d.date)).toEqual(["2026-08-15", "2026-08-16"]);
    expect(out[0]).toEqual({
      date: "2026-08-15",
      label: expect.stringMatching(/^\d{1,2}\/\d{1,2}$/),
      input: 2,
      output: 0,
      cacheWrite: 0,
      total: 2,
    });
    expect(out[1]!.input).toBe(4);
    expect(out[1]!.output).toBe(1);
    expect(out[1]!.cacheWrite).toBeCloseTo(0.5, 10);
    expect(out[1]!.total).toBe(5.5);
  });

  it("rounds each stack segment to 2 decimals", () => {
    const rows = [
      { date: "2026-08-16", provider: "anthropic", model: "claude-sonnet-5", input_tokens: 3_333, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, task_count: 1 },
    ] as const;
    const out = aggregateDailyCost(rows as unknown as Parameters<typeof aggregateDailyCost>[0]);
    // 3,333 in @ $2/1M = $0.006666 → rounds to 0.01
    expect(out[0]!.input).toBeCloseTo(0.01, 10);
  });

  it("returns [] for empty input", () => {
    expect(aggregateDailyCost([])).toEqual([]);
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
    expect(out[0]!.cost).toBe(0);
    expect(out[1]!.agentId).toBe("a");
    expect(out[1]!.tokens).toBe(165);
    expect(out[1]!.taskCount).toBe(3);
  });

  it("sorts by tokens desc", () => {
    const out = aggregateByAgent(rows as unknown as Parameters<typeof aggregateByAgent>[0]);
    expect(out[0]!.tokens).toBeGreaterThanOrEqual(out[1]!.tokens);
  });

  it("accumulates per-agent cost from the rate table", () => {
    const priced = [
      { agent_id: "a", provider: "anthropic", model: "claude-sonnet-5", input_tokens: 1_000_000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, task_count: 1 },
      { agent_id: "a", provider: "anthropic", model: "claude-sonnet-5", input_tokens: 0, output_tokens: 100_000, cache_read_tokens: 0, cache_write_tokens: 0, task_count: 1 },
      { agent_id: "b", provider: "anthropic", model: "claude-opus-5", input_tokens: 200_000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, task_count: 1 },
    ] as const;
    const out = aggregateByAgent(priced as unknown as Parameters<typeof aggregateByAgent>[0]);
    // a: $2 + $1 = $3 ; b: 200k @ $5/1M = $1
    const a = out.find((r) => r.agentId === "a")!;
    const b = out.find((r) => r.agentId === "b")!;
    expect(a.cost).toBeCloseTo(3, 10);
    expect(b.cost).toBeCloseTo(1, 10);
    // default order stays tokens desc (a has more tokens too, so it leads here)
    expect(out[0]!.agentId).toBe("a");
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
      { agentId: "a", tokens: 100, taskCount: 1, cost: 0 },
      { agentId: "b", tokens: 0, taskCount: 1, cost: 0 },
      { agentId: DELETED_AGENTS_ROW_ID, tokens: 40, taskCount: 2, cost: 0 },
      { agentId: RESTRICTED_AGENTS_ROW_ID, tokens: 7, taskCount: 1, cost: 0 },
    ];
    expect(activeAgentCount(rows)).toBe(1);
  });

  it("counts only rows with recorded tokens", () => {
    const rows: AgentUsageRow[] = [
      { agentId: "a", tokens: 1, taskCount: 0, cost: 0 },
      { agentId: "b", tokens: 0, taskCount: 5, cost: 0 },
    ];
    expect(activeAgentCount(rows)).toBe(1);
    expect(activeAgentCount([])).toBe(0);
  });
});