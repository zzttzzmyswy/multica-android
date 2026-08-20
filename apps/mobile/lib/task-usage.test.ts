import { describe, expect, it } from "vitest";
import {
  collectUnmappedModels,
  estimateCacheSavings,
  estimateCost,
  formatUsd,
  summarizeTaskUsage,
  summarizeTaskUsageAcross,
} from "./task-usage";
import type { TaskUsage } from "@multica/core/types";

/** Builder so each test names only the fields it cares about. */
function slice(
  partial: Partial<TaskUsage> & Pick<TaskUsage, "model">,
): TaskUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    ...partial,
  };
}

describe("summarizeTaskUsage", () => {
  it("returns null for undefined and [] — no figure, not a free run", () => {
    expect(summarizeTaskUsage(undefined)).toBeNull();
    expect(summarizeTaskUsage([])).toBeNull();
  });

  it("rolls tokens across slices and dedups models in first-seen order", () => {
    const sum = summarizeTaskUsage([
      slice({
        model: "claude-sonnet-4-5",
        input_tokens: 1_000_000,
        output_tokens: 100_000,
        cache_read_tokens: 500_000,
        cache_write_tokens: 50_000,
      }),
      slice({ model: "gpt-5-codex", input_tokens: 800_000, output_tokens: 200_000 }),
      slice({ model: "gpt-5-codex", input_tokens: 1_000, output_tokens: 1 }),
    ]);
    expect(sum).not.toBeNull();
    expect(sum!.tokens).toBe(2_651_001);
    expect(sum!.input).toBe(1_801_000);
    expect(sum!.output).toBe(300_001);
    expect(sum!.cacheRead).toBe(500_000);
    expect(sum!.cacheWrite).toBe(50_000);
    expect(sum!.models).toEqual(["claude-sonnet-4-5", "gpt-5-codex"]);
  });

  it("sums cost per slice via the pricing table", () => {
    const sum = summarizeTaskUsage([
      slice({
        model: "claude-sonnet-4-5",
        input_tokens: 1_000_000,
        output_tokens: 100_000,
        cache_read_tokens: 500_000,
        cache_write_tokens: 50_000,
      }),
      slice({ model: "gpt-5-codex", input_tokens: 800_000, output_tokens: 200_000 }),
      slice({ model: "unmapped-model-x", input_tokens: 1_000_000 }),
    ]);
    // $4.8375 + $3.00 + $0.00 (unmapped never fabricates spend).
    expect(sum!.cost).toBeCloseTo(7.8375, 5);
  });
});

describe("estimateCost", () => {
  it("returns 0 for an unmapped model with no authoritative cost", () => {
    expect(
      estimateCost(slice({ model: "no-such-model", input_tokens: 1_000_000 })),
    ).toBe(0);
  });

  it("charges a mapped model from the table", () => {
    expect(
      estimateCost(
        slice({
          model: "claude-sonnet-4-5",
          input_tokens: 1_000_000,
          output_tokens: 100_000,
          cache_read_tokens: 500_000,
          cache_write_tokens: 50_000,
        }),
      ),
    ).toBeCloseTo(4.8375, 5);
  });

  it("prefers the provider-reported cost when present", () => {
    // 1M input on sonnet-4-5 would estimate $3.00; the tick figure wins.
    expect(
      estimateCost(
        slice({
          model: "claude-sonnet-4-5",
          input_tokens: 1_000_000,
          cost_usd_ticks: 5_000_000_000,
        }),
      ),
    ).toBeCloseTo(0.5, 8);
  });

  it("resolves provider-qualified generic ids only under that provider", () => {
    // `auto` alone is not priced; `cursor/auto` is.
    expect(estimateCost(slice({ model: "auto", input_tokens: 1_000_000 }))).toBe(0);
    expect(
      estimateCost(
        slice({ model: "auto", provider: "cursor", input_tokens: 1_000_000 }),
      ),
    ).toBeCloseTo(1.25, 5);
  });

  it("canonicalizes claude dot ids, trailing dates, and context tags", () => {
    expect(
      estimateCost(
        slice({ model: "claude-opus-4.7", input_tokens: 1_000_000 }),
      ),
    ).toBeCloseTo(5, 5);
    expect(
      estimateCost(
        slice({ model: "claude-sonnet-4-5-20260315", input_tokens: 1_000_000 }),
      ),
    ).toBeCloseTo(3, 5);
    expect(
      estimateCost(slice({ model: "claude-opus-4-7[1m]", input_tokens: 1_000_000 })),
    ).toBeCloseTo(5, 5);
  });
});

describe("summarizeTaskUsageAcross", () => {
  it("is null when no run carries usage", () => {
    expect(summarizeTaskUsageAcross([undefined, []])).toBeNull();
    expect(summarizeTaskUsageAcross([])).toBeNull();
  });

  it("merges only the runs that have usage", () => {
    const sum = summarizeTaskUsageAcross([
      undefined,
      [],
      [slice({ model: "gpt-5-mini", input_tokens: 1_000_000, output_tokens: 500_000 })],
      [slice({ model: "claude-haiku-4-5", input_tokens: 2_000_000 })],
    ]);
    expect(sum!.tokens).toBe(3_500_000);
    expect(sum!.cost).toBeCloseTo(3.25, 5); // gpt-5-mini $1.25 + haiku-4-5 $2
  });
});

describe("formatUsd", () => {
  it("shows cents below $100 and whole dollars above", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(4.92)).toBe("$4.92");
    expect(formatUsd(99.99)).toBe("$99.99");
    expect(formatUsd(100)).toBe("$100");
    expect(formatUsd(2_100_000)).toBe("$2100000");
  });
});

describe("estimateCacheSavings", () => {
  it("is the gap between full input price and the cache-hit rate", () => {
    // claude-sonnet-4-5: input $3/M, cacheRead $0.30/M → 1M reads save $2.70.
    expect(
      estimateCacheSavings(
        slice({ model: "claude-sonnet-4-5", cache_read_tokens: 1_000_000 }),
      ),
    ).toBeCloseTo(2.7, 6);
  });

  it("is 0 for an unmapped model — no rate to price the discount", () => {
    expect(
      estimateCacheSavings(
        slice({ model: "no-such-model", cache_read_tokens: 1_000_000 }),
      ),
    ).toBe(0);
  });

  it("resolves provider-qualified generic ids only under that provider", () => {
    expect(
      estimateCacheSavings(
        slice({ model: "auto", cache_read_tokens: 1_000_000 }),
      ),
    ).toBe(0);
    // cursor/auto: input $1.25/M, cacheRead $0.25/M → 1M reads save $1.00.
    expect(
      estimateCacheSavings(
        slice({ model: "auto", provider: "cursor", cache_read_tokens: 1_000_000 }),
      ),
    ).toBeCloseTo(1.0, 6);
  });

  it("prices a provider-capped cache read too — the row cost is a bill, the discount is a rate-table fact", () => {
    // cost_usd_ticks means the provider priced the turn; the savings figure
    // is still the rate gap on the row's cache reads (web parity).
    expect(
      estimateCacheSavings(
        slice({
          model: "claude-sonnet-4-5",
          cache_read_tokens: 500_000,
          cost_usd_ticks: 5_000_000_000,
        }),
      ),
    ).toBeCloseTo(1.35, 6);
  });
});

describe("summarizeTaskUsage cacheSavings", () => {
  it("rolls cacheSavings across slices like the web summary", () => {
    const sum = summarizeTaskUsage([
      slice({ model: "claude-sonnet-4-5", cache_read_tokens: 1_000_000 }),
      slice({ model: "claude-sonnet-4-5", cache_read_tokens: 500_000 }),
    ]);
    expect(sum!.cacheSavings).toBeCloseTo(4.05, 6); // 1.5M reads × $2.70/M
  });

  it("adds no savings for unmapped models — same no-figure, no-fabricate rule", () => {
    const sum = summarizeTaskUsage([
      slice({ model: "claude-sonnet-4-5", cache_read_tokens: 1_000_000 }),
      slice({ model: "mystery-model", cache_read_tokens: 2_000_000 }),
    ]);
    expect(sum!.cacheSavings).toBeCloseTo(2.7, 6);
  });
});

describe("collectUnmappedModels", () => {
  it("is empty when every model resolves", () => {
    expect(
      collectUnmappedModels([
        slice({ model: "claude-sonnet-4-5", input_tokens: 100 }),
        slice({ model: "cursor/auto", provider: "cursor", cache_read_tokens: 10 }),
      ]),
    ).toEqual([]);
  });

  it("lists an unmapped model with tokens — counted, not fabricated", () => {
    expect(
      collectUnmappedModels([
        slice({ model: "mystery-model", input_tokens: 100 }),
      ]),
    ).toEqual(["mystery-model"]);
  });

  it("ignores an unmapped model the provider priced in full", () => {
    // cost_usd_ticks on a token-less, rate-less row is a real bill: nothing
    // to estimate, so no "we can't price this" warning (web parity).
    expect(
      collectUnmappedModels([
        slice({ model: "mystery-model", cost_usd_ticks: 1_000_000_000 }),
      ]),
    ).toEqual([]);
  });

  it("provider-qualifies generic ids so two providers stay distinct", () => {
    expect(
      collectUnmappedModels([
        slice({ model: "custom-model", provider: "acme", input_tokens: 100 }),
      ]),
    ).toEqual(["acme/custom-model"]);
  });

  it("returns unique keys sorted ascending (no toSorted — Hermes)", () => {
    expect(
      collectUnmappedModels([
        slice({ model: "z-model", input_tokens: 1 }),
        slice({ model: "a-model", output_tokens: 1 }),
        slice({ model: "a-model", cache_read_tokens: 1 }),
      ]),
    ).toEqual(["a-model", "z-model"]);
  });

  it("skips rows without a model — nothing to name in the note", () => {
    expect(
      collectUnmappedModels([
        {
          model: "",
          input_tokens: 100,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
        },
      ]),
    ).toEqual([]);
  });
});