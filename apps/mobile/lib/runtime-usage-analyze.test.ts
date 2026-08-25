/**
 * Tests for lib/runtime-usage.ts analysis extensions (iteration-103, MYS-712)
 * — window slicing, deltas, weekly aggregation, cost-by attribution, unmapped
 * model discovery, and the custom-pricing override wiring. Semantics mirror
 * web packages/views/runtimes/utils.ts so numbers agree with the web runtime
 * usage panel for the same rows.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { RuntimeUsage, RuntimeUsageByAgent } from "@multica/core/types";
import {
  addDaysIso,
  aggregateByDate,
  aggregateByWeek,
  aggregateCostByAgent,
  aggregateCostByModel,
  collectUnmappedModels,
  computeHeatmapCells,
  diffDaysIso,
  estimateCost,
  estimateCostBreakdown,
  formatShortDate,
  isModelPriced,
  modelGroupingKey,
  pctChange,
  pricingKey,
  sliceWindow,
  todayIso,
  weekStartIso,
} from "./runtime-usage";
import {
  setCustomPricing,
  removeCustomPricing,
  resetCustomPricingForTests,
} from "./custom-pricing-store";

function row(partial: Partial<RuntimeUsage>): RuntimeUsage {
  return {
    runtime_id: "rt-1",
    date: "2026-08-20",
    provider: "",
    model: "",
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    ...partial,
  };
}

function agentRow(partial: Partial<RuntimeUsageByAgent>): RuntimeUsageByAgent {
  return {
    agent_id: "a-1",
    provider: "",
    model: "",
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    task_count: 0,
    ...partial,
  };
}

const FROZEN_DAY = "2026-08-25T12:00:00Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FROZEN_DAY));
  resetCustomPricingForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("calendar helpers", () => {
  it("todayIso reads the calendar date in the given tz", () => {
    expect(todayIso("UTC")).toBe("2026-08-25");
    // Asia/Shanghai is UTC+8 — same instant, next calendar day (+8h).
    expect(todayIso("Asia/Shanghai")).toBe("2026-08-25");
  });

  it("addDaysIso does pure date math without tz drift", () => {
    expect(addDaysIso("2026-08-25", -7)).toBe("2026-08-18");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28"); // leap-year Feb
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("weekStartIso returns Monday of the ISO week", () => {
    expect(weekStartIso("2026-01-05")).toBe("2026-01-05"); // Monday
    expect(weekStartIso("2026-01-08")).toBe("2026-01-05"); // Thursday
    expect(weekStartIso("2026-01-04")).toBe("2025-12-29"); // Sunday → prev Mon
  });

  it("diffDaysIso measures whole-day spans", () => {
    expect(diffDaysIso("2026-08-24", "2026-08-31")).toBe(7);
    expect(diffDaysIso("2026-08-31", "2026-08-24")).toBe(-7);
  });

  it("formatShortDate renders locale-short month/day", () => {
    expect(formatShortDate("2026-05-12")).toBe("May 12");
  });
});

describe("pctChange", () => {
  it("computes rounded percent change", () => {
    expect(pctChange(120, 100)).toBe(20);
    expect(pctChange(80, 100)).toBe(-20);
    expect(pctChange(0, 100)).toBe(-100);
  });

  it("returns null when the previous window is zero", () => {
    expect(pctChange(0, 0)).toBeNull();
    expect(pctChange(10, 0)).toBeNull();
  });
});

describe("sliceWindow", () => {
  it("splits rows into current and immediately-prior windows of equal length", () => {
    const usage = [
      row({ date: "2026-08-10" }),
      row({ date: "2026-08-11" }),
      row({ date: "2026-08-17" }),
      row({ date: "2026-08-18" }),
      row({ date: "2026-08-24" }),
      row({ date: "2026-08-25" }),
    ];
    const { filtered, prevFiltered } = sliceWindow(usage, 7, "UTC");
    expect(filtered.map((u) => u.date)).toEqual([
      "2026-08-18",
      "2026-08-24",
      "2026-08-25",
    ]);
    expect(prevFiltered.map((u) => u.date)).toEqual(["2026-08-11", "2026-08-17"]);
  });
});

describe("custom-pricing override wiring", () => {
  it("estimateCost falls back to a custom rate for an unmapped model", () => {
    const u = row({ model: "gpt-9.9-unknown", input_tokens: 2_000_000 });
    expect(estimateCost(u)).toBe(0);
    setCustomPricing("gpt-9.9-unknown", {
      input: 0.5,
      output: 2,
      cacheRead: 0.1,
      cacheWrite: 0.5,
    });
    expect(estimateCost(u)).toBeCloseTo(1, 5); // 2M × $0.5/M
  });

  it("custom rates are keyed per pricing key (provider-qualified)", () => {
    setCustomPricing("openrouter/gpt-9.9-unknown", {
      input: 9,
      output: 9,
      cacheRead: 0,
      cacheWrite: 0,
    });
    // provider-qualified row resolves via the override…
    expect(
      estimateCost(
        row({ model: "gpt-9.9-unknown", provider: "openrouter", input_tokens: 1_000_000 }),
      ),
    ).toBeCloseTo(9, 5);
    // …a bare `gpt-9.9-unknown` with no provider must NOT borrow it.
    expect(estimateCost(row({ model: "gpt-9.9-unknown", input_tokens: 1_000_000 }))).toBe(0);
    removeCustomPricing("openrouter/gpt-9.9-unknown");
  });
});

describe("modelGroupingKey", () => {
  it("keeps self-resolving ids bare, qualifies generic ids", () => {
    expect(modelGroupingKey("claude-opus-4-7")).toBe("claude-opus-4-7");
    expect(modelGroupingKey("auto", "cursor")).toBe("cursor/auto");
    expect(modelGroupingKey("gpt-5-mini")).toBe("gpt-5-mini");
    expect(modelGroupingKey("", "cursor")).toBe("cursor");
    expect(modelGroupingKey("")).toBe("unknown");
  });

  it("pricingKey is the plain provider-qualified form", () => {
    expect(pricingKey("auto", "cursor")).toBe("cursor/auto");
    expect(pricingKey("gpt-5", undefined)).toBe("gpt-5");
  });

  it("isModelPriced probes table + overrides", () => {
    expect(isModelPriced("claude-sonnet-5")).toBe(true);
    expect(isModelPriced("gpt-9.9-unknown")).toBe(false);
    setCustomPricing("gpt-9.9-unknown", {
      input: 1,
      output: 1,
      cacheRead: 1,
      cacheWrite: 1,
    });
    expect(isModelPriced("gpt-9.9-unknown")).toBe(true);
    resetCustomPricingForTests();
  });
});

describe("collectUnmappedModels", () => {
  it("lists unpriced models that carry unpriced tokens, sorted + provider-qualified", () => {
    const out = collectUnmappedModels([
      row({ model: "zzz-new", provider: "openrouter", input_tokens: 100 }),
      row({ model: "aaa-new", input_tokens: 100 }),
      row({ model: "claude-sonnet-5", input_tokens: 100 }), // priced → skip
    ]);
    expect(out).toEqual(["aaa-new", "openrouter/zzz-new"]);
  });

  it("skips rows the provider priced in full (authoritative cost, no estimate needed)", () => {
    const out = collectUnmappedModels([
      row({
        model: "mystery",
        input_tokens: 100,
        cost_usd_ticks: 5_000_000_000,
        uncosted_input_tokens: 0,
        uncosted_output_tokens: 0,
        uncosted_cache_read_tokens: 0,
        uncosted_cache_write_tokens: 0,
      }),
    ]);
    expect(out).toEqual([]);
  });
});

describe("estimateCostBreakdown", () => {
  it("splits a fully-estimated row across input/output/cacheWrite", () => {
    const u = row({
      model: "claude-sonnet-5",
      input_tokens: 1_000_000, // $2
      output_tokens: 500_000, // $5
      cache_write_tokens: 100_000, // $0.25
    });
    const b = estimateCostBreakdown(u);
    expect(b.input).toBeCloseTo(2, 5);
    expect(b.output).toBeCloseTo(5, 5);
    expect(b.cacheWrite).toBeCloseTo(0.25, 5);
  });

  it("lands the whole authoritative charge in one bucket when unpriced but billed", () => {
    const u = row({
      model: "mystery",
      input_tokens: 100,
      cost_usd_ticks: 5_000_000_000,
    });
    const b = estimateCostBreakdown(u);
    expect(b.input).toBeCloseTo(0.5, 9);
    expect(b.output).toBe(0);
    expect(b.cacheRead).toBe(0);
    expect(b.cacheWrite).toBe(0);
  });

  it("sums back to estimateCost on mixed rows", () => {
    const u = row({
      model: "gpt-5-mini",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      uncosted_input_tokens: 0,
      uncosted_output_tokens: 1_000_000,
      cost_usd_ticks: 3_000_000_000,
    });
    const b = estimateCostBreakdown(u);
    const total = b.input + b.output + b.cacheRead + b.cacheWrite;
    expect(total).toBeCloseTo(estimateCost(u), 5);
  });
});

describe("aggregateByDate", () => {
  it("folds per-(date,model) rows into daily token + cost-stack series", () => {
    const { dailyTokens, dailyCostStack, modelDist } = aggregateByDate([
      row({ date: "2026-08-20", model: "gpt-5-mini", input_tokens: 1_000_000 }),
      row({ date: "2026-08-20", model: "gpt-5-mini", output_tokens: 1_000_000 }),
      row({ date: "2026-08-22", model: "claude-sonnet-5", input_tokens: 1_000_000 }),
    ]);
    expect(dailyTokens.map((d) => d.date)).toEqual(["2026-08-20", "2026-08-22"]);
    expect(dailyTokens[0]).toMatchObject({ input: 1_000_000, output: 1_000_000 });
    expect(dailyTokens[0]!.label).toBe("8/20");
    // gpt-5-mini: input 1M @ $0.25 + output 1M @ $2 = $2.25
    expect(dailyCostStack[0]!.total).toBeCloseTo(2.25, 5);
    expect(dailyCostStack[1]!.total).toBeCloseTo(2, 5); // claude sonnet input
    // modelDist sorted by tokens desc
    expect(modelDist[0]!.model).toBe("gpt-5-mini");
    expect(modelDist[0]!.tokens).toBe(2_000_000);
  });
});

describe("aggregateByWeek", () => {
  it("pre-zeroes trailing weeks and folds rows into Mon-start weeks", () => {
    // FROZEN_DAY = Tue 2026-08-25 → current week starts Mon 2026-08-24.
    const { weeklyTokens, weeklyCostStack } = aggregateByWeek(
      [
        row({ date: "2026-08-12", model: "claude-sonnet-5", input_tokens: 1_000_000 }),
        row({ date: "2026-08-20", model: "claude-sonnet-5", input_tokens: 1_000_000 }),
      ],
      "UTC",
      3,
    );
    expect(weeklyTokens.map((w) => w.weekStart)).toEqual([
      "2026-08-10",
      "2026-08-17",
      "2026-08-24",
    ]);
    // partial current week: today is Tuesday, elapsed = 2 days
    expect(weeklyTokens[2]).toMatchObject({ weekStart: "2026-08-24", partial: true, daysCovered: 2 });
    expect(weeklyTokens[1]).toMatchObject({ weekStart: "2026-08-17", partial: false, daysCovered: 7 });
    expect(weeklyTokens[0]!.input).toBe(1_000_000);
    expect(weeklyTokens[1]!.input).toBe(1_000_000);
    expect(weeklyTokens[2]!.input).toBe(0);
    expect(weeklyCostStack[1]!.total).toBeCloseTo(2, 5);
  });

  it("drops rows outside the trailing window", () => {
    const { weeklyTokens } = aggregateByWeek(
      [row({ date: "2026-06-01", model: "gpt-5-mini", input_tokens: 1_000_000 })],
      "UTC",
      4, // window = 2026-07-27 … 2026-08-24
    );
    expect(weeklyTokens.map((w) => w.input)).toEqual([0, 0, 0, 0]);
  });
});

describe("aggregateCostByAgent / aggregateCostByModel", () => {
  it("sums per-agent cost+tokens+taskCount, sorted by cost desc", () => {
    const out = aggregateCostByAgent([
      agentRow({
        agent_id: "a-2",
        model: "claude-sonnet-5",
        input_tokens: 1_000_000, // $2
        task_count: 3,
      }),
      agentRow({
        agent_id: "a-1",
        model: "gpt-5-mini",
        input_tokens: 1_000_000, // $0.25
        task_count: 1,
      }),
      agentRow({
        agent_id: "a-2",
        model: "gpt-5-mini",
        input_tokens: 1_000_000, // $0.25
        task_count: 2,
      }),
    ]);
    expect(out.map((r) => r.key)).toEqual(["a-2", "a-1"]);
    expect(out[0]).toMatchObject({ key: "a-2", tokens: 2_000_000, taskCount: 5 });
    expect(out[0]!.cost).toBeCloseTo(2.25, 5);
    expect(out[1]!.cost).toBeCloseTo(0.25, 5);
  });

  it("groups by-model via modelGroupingKey and sorts by cost", () => {
    const out = aggregateCostByModel([
      row({ model: "auto", provider: "cursor", input_tokens: 1_000_000 }),
      row({ model: "gpt-5-mini", input_tokens: 1_000_000 }),
      row({ model: "gpt-5-mini", output_tokens: 1_000_000 }),
    ]);
    expect(out.map((r) => r.key)).toEqual(["gpt-5-mini", "cursor/auto"]);
    expect(out[0]!.cost).toBeCloseTo(2.25, 5); // $0.25 + $2
    expect(out[1]!.cost).toBeCloseTo(1.25, 5);
  });
});

describe("computeHeatmapCells", () => {
  it("anchors a Mon-first 26-week grid at today and assigns intensity levels", () => {
    const today = todayIso("UTC"); // 2026-08-25 (Tue)
    const hud = computeHeatmapCells(
      [
        row({ date: today, model: "gpt-5-mini", input_tokens: 1_000_000 }),
        row({ date: "2026-08-20", model: "gpt-5-mini", input_tokens: 1_000_000 }),
        row({ date: "2026-08-09", model: "gpt-5-mini", input_tokens: 1_000_000 }),
      ],
      "UTC",
    );
    expect(hud.cells.length).toBeGreaterThan(6 * 7); // at least full weeks
    expect(hud.cells[0]!.dayOfWeek).toBe(0); // Mon-first
    expect(hud.cells[0]!.week).toBe(0);
    expect(hud.cells[hud.cells.length - 1]!.date).toBe(today);
    // The three spent days carry cost > 0 → level ≥ 1.
    const spent = hud.cells.filter((c) => c.cost > 0);
    expect(spent).toHaveLength(3);
    for (const c of spent) expect(c.level).toBeGreaterThanOrEqual(1);
    // Insights: busiest day = today (highest? tie → first found), total>0.
    expect(hud.insights.totalCost).toBeCloseTo(0.25 * 3, 5);
    expect(hud.insights.windowDays).toBe(hud.cells.length);
  });
});