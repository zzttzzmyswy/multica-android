/**
 * Tests for lib/runtime-usage.ts (MYS-676) — cost math parity with web's
 * packages/views/runtimes/utils.ts (estimateCost / estimateCacheSavings /
 * aggregateByDate). Values asserted here are the same ones web's own
 * utils.test.ts asserts, so a drift in either direction fails loudly.
 */
import { describe, expect, it } from "vitest";
import type { RuntimeUsage } from "@multica/core/types";
import {
  aggregateRuntimeCostByDate,
  computeRuntimeTotals,
  estimateCacheSavings,
  estimateCost,
  formatUsd,
} from "./runtime-usage";

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

describe("estimateCost", () => {
  it("prices a known model from the rate table (input/output/cache split)", () => {
    const u = row({
      model: "claude-sonnet-5",
      input_tokens: 1_000_000, // $2
      output_tokens: 500_000, // $5
      cache_read_tokens: 100_000, // $0.02
      cache_write_tokens: 100_000, // $0.25
    });
    expect(estimateCost(u)).toBeCloseTo(7.27, 5);
  });

  it("uses the provider-qualified key for generic model ids (cursor/auto)", () => {
    const u = row({
      model: "auto",
      provider: "cursor",
      input_tokens: 1_000_000,
    });
    expect(estimateCost(u)).toBeCloseTo(1.25, 5);
    // Same bare id with NO provider must NOT borrow Cursor's rate.
    expect(estimateCost(row({ model: "auto", input_tokens: 1_000_000 }))).toBe(0);
  });

  it("strips date snapshots and Anthropic dot↔dash drift to the family tier", () => {
    const dated = row({
      model: "claude-sonnet-4-5-20250929",
      input_tokens: 1_000_000,
    });
    expect(estimateCost(dated)).toBeCloseTo(3, 5);
    const dotted = row({ model: "claude-sonnet-4.5", input_tokens: 1_000_000 });
    expect(estimateCost(dotted)).toBeCloseTo(3, 5);
  });

  it("returns only the authoritative cost for a row the provider priced", () => {
    // 0.5 USD in ticks; no uncosted split payload → nothing estimated on top.
    const u = row({
      model: "claude-sonnet-5",
      input_tokens: 1_000_000,
      cost_usd_ticks: 5_000_000_000,
    });
    expect(estimateCost(u)).toBeCloseTo(0.5, 9);
  });

  it("falls back to full-token estimation when a provider priced nothing (pre-split backend)", () => {
    const u = row({
      model: "gpt-5-mini",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(estimateCost(u)).toBeCloseTo(2.25, 5);
  });

  it("splits authoritative cost plus the un-priced half (cost split payload)", () => {
    const u = row({
      model: "gpt-5-mini",
      input_tokens: 1_000_000,
      // 1M tokens already charged $0.30 by the provider; the other 1M output
      // tokens are un-priced and estimated at gpt-5-mini output rate. The
      // cost-split branch is keyed on `uncosted_input_tokens` being PRESENT
      // (0 here), not undefined — like web.
      output_tokens: 1_000_000,
      uncosted_input_tokens: 0,
      uncosted_output_tokens: 1_000_000,
      cost_usd_ticks: 3_000_000_000,
    });
    expect(estimateCost(u)).toBeCloseTo(0.3 + 2, 5);
  });

  it("returns 0 for an unpriced model with no authoritative cost", () => {
    expect(estimateCost(row({ model: "gpt-9.9-unknown", input_tokens: 10_000_000 }))).toBe(0);
    expect(estimateCost(row({ input_tokens: 10_000_000 }))).toBe(0);
  });
});

describe("estimateCacheSavings", () => {
  it("saves input-rate minus cache-read-rate on cache_read_tokens", () => {
    const u = row({
      model: "claude-sonnet-5",
      cache_read_tokens: 100_000,
    });
    // (2 - 0.20) * 0.1 = 0.18
    expect(estimateCacheSavings(u)).toBeCloseTo(0.18, 5);
  });

  it("returns 0 for an unpriced model", () => {
    expect(estimateCacheSavings(row({ model: "nope", cache_read_tokens: 999 }))).toBe(0);
  });
});

describe("computeRuntimeTotals", () => {
  it("rolls cost, cache savings and token buckets across rows", () => {
    const totals = computeRuntimeTotals([
      row({ model: "claude-sonnet-5", input_tokens: 1_000_000 }),
      row({ model: "claude-sonnet-5", cache_read_tokens: 100_000 }),
    ]);
    expect(totals.cost).toBeCloseTo(2.02, 5);
    expect(totals.cacheSavings).toBeCloseTo(0.18, 5);
    expect(totals.input).toBe(1_000_000);
    expect(totals.cacheRead).toBe(100_000);
    expect(totals.cacheWrite).toBe(0);
  });
});

describe("aggregateRuntimeCostByDate", () => {
  it("groups per date, sorts ascending, labels M/D", () => {
    const out = aggregateRuntimeCostByDate([
      row({ date: "2026-08-22", model: "gpt-5-mini", input_tokens: 1_000_000 }),
      row({ date: "2026-08-20", model: "gpt-5-mini", input_tokens: 1_000_000 }),
      row({ date: "2026-08-20", model: "gpt-5-mini", input_tokens: 1_000_000 }),
    ]);
    expect(out.map((d) => d.date)).toEqual(["2026-08-20", "2026-08-22"]);
    expect(out[0]!.label).toBe("8/20");
    expect(out[0]!.cost).toBeCloseTo(0.5, 5); // 2 rows × $0.25
    expect(out[0]!.totalTokens).toBe(2_000_000);
    expect(out[1]!.cost).toBeCloseTo(0.25, 5);
  });

  it("returns empty for empty input", () => {
    expect(aggregateRuntimeCostByDate([])).toEqual([]);
  });
});

describe("formatUsd", () => {
  it("keeps two decimals under $100, cents above", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(7.27)).toBe("$7.27");
    expect(formatUsd(99.999)).toBe("$100.00");
  });

  it("rounds to whole dollars at $100+", () => {
    expect(formatUsd(100)).toBe("$100");
    expect(formatUsd(1234.56)).toBe("$1235");
  });
});