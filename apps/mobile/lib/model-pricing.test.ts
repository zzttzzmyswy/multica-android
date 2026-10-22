/**
 * The rate table and its resolver — iteration 268 (MYS-2317).
 *
 * The defect this suite pins is not a wrong formula, it is a table that had
 * silently gone stale in TWO copies. Measured against 229 live usage rows on
 * mu.zztweb.top before this iteration: 199 of them priced to $0 on mobile
 * while web priced them, so the same issue read $476.78 on the phone and
 * $986.97 in the browser. Two models carried almost all of it —
 * `claude-sonnet-5-5[1m]` and `claude-opus-5-5[1m]`, i.e. the two models this
 * workspace actually runs.
 *
 * So the assertions here are about AGREEMENT, not about arithmetic:
 *
 *   1. the table carries every SKU upstream prices, at upstream's numbers;
 *   2. one table, not two — a second copy is how the drift happened;
 *   3. the live model strings this deployment reports resolve;
 *   4. the resolver's tolerances match web's (nested prefixes, Anthropic
 *      dot↔dash, `[1m]` tags, Gemini display labels), and the ones web
 *      deliberately does NOT have (no startsWith borrowing);
 *   5. money renders identically from both venues.
 *
 * The upstream numbers are transcribed by
 * `scripts/sync-model-pricing.py --check`, which re-derives them from
 * `origin/main:packages/views/runtimes/utils.ts`. That script is the actual
 * ratchet against future drift; this file pins the decisions.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cacheHitRatePercent,
  cacheHitRateRatio,
  canonicalCandidates,
  isModelPriced,
  pricingCandidates,
  pricingKey,
  resolvePricing,
} from "./model-pricing";

const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Every `"key": { input: … }` row in a pricing table source. */
function rows(src: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const re =
    /^\s*"([^"]+)":\s*\{\s*input:\s*([\d.]+),\s*output:\s*([\d.]+),\s*cacheRead:\s*([\d.]+),\s*cacheWrite:\s*([\d.]+)\s*\}/gm;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    out.set(
      m[1]!,
      [2, 3, 4, 5].map((i) => Number(m![i])),
    );
  }
  return out;
}

describe("the rate table is upstream's table", () => {
  const table = rows(code("lib/model-pricing.ts"));

  it("is not the 61-row snapshot that shipped before this iteration", () => {
    // The pre-fix table. Anything at or below this means the sync did not
    // happen (or was reverted), and the $0 pricing comes back.
    expect(table.size).toBeGreaterThan(140);
  });

  it("prices the two models this workspace actually runs", () => {
    // These two ids are the entire measurable defect: they were 175 of the
    // 199 unpriced live rows. A regression that drops them is invisible in
    // any test that only checks "some model prices".
    expect(resolvePricing("claude-sonnet-5-5[1m]")).toEqual({
      input: 2,
      output: 10,
      cacheRead: 0.1,
      cacheWrite: 2.5,
    });
    expect(resolvePricing("claude-opus-5-5[1m]")).toEqual({
      input: 4,
      output: 20,
      cacheRead: 0.2,
      cacheWrite: 5,
    });
  });

  it("carries the Anthropic 5.5 rows at the lower cache-read tier", () => {
    // Sonnet 5.5 / Haiku 5.5 halve the cache-read rate versus their 5.0
    // predecessors. Copying 5.0's row for the 5.5 id is the plausible slip,
    // and it would overstate a cache-heavy run's cost by ~20x on that column.
    expect(resolvePricing("claude-sonnet-5-5")!.cacheRead).toBe(0.1);
    expect(resolvePricing("claude-haiku-5-5")!.cacheRead).toBe(0.01);
  });

  it("carries the Gemini SKUs, including the TTS and transcribe rows", () => {
    // The whole Google family was absent, which is a silent $0 for anyone on
    // Gemini. Speech-only SKUs have one input/output rate and no cache
    // buckets; they are easy to skip and easy to spot when missing.
    expect(resolvePricing("gemini-3.8-flash")).toEqual({
      input: 0.75,
      output: 3.75,
      cacheRead: 0.075,
      cacheWrite: 0.75,
    });
    expect(resolvePricing("gemini-2.5-pro")!.input).toBe(1.25);
    expect(resolvePricing("gemini-4-argon")!.input).toBe(2);
    expect(resolvePricing("gemini-3.8-flash-tts")!.cacheRead).toBe(0);
  });

  it("carries the Cursor per-SKU rows rather than only the Composer ones", () => {
    // Cursor rows are provider-qualified, so they only win when the row
    // carries `provider: "cursor"` — a table with only `cursor/composer-*`
    // leaves every Cursor Claude/ GPT/ Gemini run at $0.
    expect(resolvePricing("claude-sonnet-5-5", "cursor")!.input).toBe(2);
    expect(resolvePricing("gpt-5.4", "cursor")!.input).toBe(2.5);
    expect(resolvePricing("gemini-3.8-flash", "cursor")!.cacheWrite).toBe(0);

    // A Cursor row that has NO bare counterpart. The ids above all also exist
    // unqualified, so they would still resolve if every `cursor/*` row were
    // deleted — they cannot tell the two apart. These can: `gpt-5.6-sol` costs
    // 5/30 bare and 4/20 through Cursor, and `glm-5.2` / `kimi-k3` are
    // Cursor-only at this radius.
    expect(resolvePricing("gpt-5.6-sol")).toEqual({
      input: 5,
      output: 30,
      cacheRead: 0.5,
      cacheWrite: 6.25,
    });
    expect(resolvePricing("gpt-5.6-sol", "cursor")).toEqual({
      input: 4,
      output: 20,
      cacheRead: 0.4,
      cacheWrite: 5,
    });
    expect(isModelPriced("glm-5.2", "cursor")).toBe(true);
    expect(isModelPriced("glm-5.2")).toBe(false);
  });

  it("keeps the Cursor fast tiers distinct from their standard rows", () => {
    // A fast tier is not a naming variant — it is priced differently, so a
    // `-fast` strip would silently halve it.
    expect(resolvePricing("cursor/claude-opus-4-7-fast")!.input).toBe(30);
    expect(resolvePricing("cursor/claude-opus-4-7")!.input).toBe(5);
  });
});

describe("one table, one resolver", () => {
  it("neither cost venue defines its own table", () => {
    // The specific regression: a copy local to either module drifts again,
    // and the phone quotes two numbers for one run.
    for (const rel of ["lib/task-usage.ts", "lib/runtime-usage.ts"]) {
      const src = code(rel);
      expect(src, `${rel} must not own a rate table`).not.toMatch(
        /Record<string,\s*(ModelPrice|\{[^}]*input)/,
      );
      expect(src, `${rel} must not own a candidate derivation`).not.toMatch(
        /function canonicalCandidates/,
      );
    }
  });

  it("both venues price the same row identically at runtime", async () => {
    // Not a source assertion: actually route one live-shaped row through each
    // public entry point and require the same dollars.
    const taskUsage = await import("./task-usage");
    const runtimeUsage = await import("./runtime-usage");
    const slice = {
      provider: "claude",
      model: "claude-sonnet-5-5[1m]",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_tokens: 1_000_000,
      cache_write_tokens: 1_000_000,
    };
    const issueSide = taskUsage.estimateCost(slice);
    const runtimeSide = runtimeUsage.estimateCost(slice);
    expect(issueSide).toBeCloseTo(2 + 10 + 0.1 + 2.5, 10);
    expect(runtimeSide).toBeCloseTo(issueSide, 10);
  });
});

describe("lookup tolerances match web", () => {
  it("peels nested provider prefixes, both `/` and `:`", () => {
    // `custom:anthropic/claude-opus-4.7` is a Hermes custom provider whose
    // model segment is itself provider-prefixed. Stripping one layer only
    // leaves `anthropic/claude-opus-4.7`, which is not a table key.
    expect(resolvePricing("custom:anthropic/claude-opus-4.7")).toEqual(
      resolvePricing("claude-opus-4-7"),
    );
    expect(canonicalCandidates("custom:anthropic/claude-opus-4.7")).toContain(
      "claude-opus-4.7",
    );
  });

  it("treats Anthropic dots and dashes as the same SKU, and only Anthropic", () => {
    // Copilot reports `claude-opus-4.7`, Claude Code reports
    // `claude-opus-4-7`. For OpenAI the separator IS semantic, so `gpt-5.4`
    // must not become `gpt-5-4` and, crucially, `gpt-5-4` must not resolve.
    expect(resolvePricing("claude-opus-4.7")).toEqual(
      resolvePricing("claude-opus-4-7"),
    );
    expect(canonicalCandidates("gpt-5.4")).not.toContain("gpt-5-4");
    expect(isModelPriced("gpt-5-4")).toBe(false);
  });

  it("prices a `[1m]` context-tagged id at the standard tier", () => {
    // Aggregated usage rows carry no per-request prompt size, so the 1M-beta
    // variant prices at the standard tier — an under-estimate, which web
    // prefers over dropping the row entirely.
    expect(resolvePricing("claude-opus-5-5[1m]")).toEqual(
      resolvePricing("claude-opus-5-5"),
    );
  });

  it("normalizes Antigravity's Gemini display labels and effort suffixes", () => {
    expect(resolvePricing("gemini 3.8 flash")).toEqual(
      resolvePricing("gemini-3.8-flash"),
    );
    expect(resolvePricing("gemini-3.8-flash-high")).toEqual(
      resolvePricing("gemini-3.8-flash"),
    );
    // Only recognized shapes: never strip an arbitrary trailing word.
    expect(canonicalCandidates("gemini-3.8-flash-turbo")).toEqual([
      "gemini-3.8-flash-turbo",
    ]);
  });

  it("never borrows a near-named relative's price", () => {
    // Web's explicit rule: no startsWith fallback. A hypothetical
    // `gpt-5.5-mini` must not inherit `gpt-5.5`; it surfaces in the unmapped
    // diagnostic so the user can price it.
    expect(isModelPriced("gpt-5.5-mini")).toBe(false);
    expect(isModelPriced("claude-sonnet-5-5-ultra")).toBe(false);
  });

  it("leaves a bare generic id unmapped while the qualified one prices", () => {
    // `auto` is a Cursor catalog id. A row that reports it WITHOUT a provider
    // must not borrow Cursor's rate; with the provider it must.
    expect(isModelPriced("auto", "cursor")).toBe(true);
    expect(isModelPriced("auto")).toBe(false);
    expect(pricingKey("auto", "cursor")).toBe("cursor/auto");
    expect(pricingKey("auto")).toBe("auto");
  });

  it("tolerates provider case drift in the row's own value", () => {
    expect(resolvePricing("claude-sonnet-5", "Claude")).toEqual(
      resolvePricing("claude-sonnet-5", "claude"),
    );
  });

  it("strips a trailing dated snapshot but keeps the family", () => {
    expect(resolvePricing("claude-haiku-4-5-20251001")).toEqual(
      resolvePricing("claude-haiku-4-5"),
    );
    expect(resolvePricing("claude-sonnet-5-latest")).toEqual(
      resolvePricing("claude-sonnet-5"),
    );
  });
});

describe("the user's overrides sit after the table, never before", () => {
  it("a table row wins over an override for the same key", () => {
    const overrides = {
      "claude-sonnet-5": { input: 999, output: 999, cacheRead: 0, cacheWrite: 0 },
    };
    expect(resolvePricing("claude-sonnet-5", undefined, overrides)!.input).toBe(2);
  });

  it("an override prices a model the table does not know", () => {
    const overrides = {
      "my-private-model": { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 },
    };
    expect(resolvePricing("my-private-model", undefined, overrides)!.input).toBe(1);
    // …and is reachable under the provider-qualified key too, which is the
    // form the store persists (pricingKey).
    expect(
      resolvePricing("my-private-model", "myprov", {
        "myprov/my-private-model": overrides["my-private-model"],
      })!.input,
    ).toBe(1);
  });

  it("no overrides is the same as no match, not a crash", () => {
    expect(resolvePricing("nobody-knows-this", undefined, undefined)).toBeUndefined();
    expect(resolvePricing("nobody-knows-this", "x", {})).toBeUndefined();
    expect(resolvePricing("")).toBeUndefined();
  });
});

describe("cache hit rate counts every input-side bucket", () => {
  it("includes cache writes in the denominator", () => {
    // 0 cache reads, 72 read + 28 written: 72%, not 100%. The pre-fix inline
    // math divided by (input + cacheRead) only and said 100%.
    expect(cacheHitRatePercent(0, 72, 28)).toBe(72);
  });

  it("refuses to round an incomplete hit rate up to 100%", () => {
    expect(cacheHitRatePercent(45, 9_955, 0)).toBe(99);
    expect(cacheHitRatePercent(0, 10_000, 0)).toBe(100);
  });

  it("reports no figure — not 0% — when nothing was input-side", () => {
    // An output-only run did not miss the cache; it never touched it. A
    // confident "0% hit rate" would be a claim the data does not support.
    expect(cacheHitRatePercent(0, 0, 0)).toBeNull();
    expect(cacheHitRateRatio({ input: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull();
  });

  it("agrees with the ratio form web's timeline uses", () => {
    for (const [i, r, w] of [
      [22, 341_623, 57_206],
      [1_000, 1_000, 0],
      [5, 0, 0],
    ] as const) {
      const pct = cacheHitRatePercent(i, r, w)!;
      const ratio = cacheHitRateRatio({ input: i, cacheRead: r, cacheWrite: w })!;
      // The percent form rounds and caps; the ratio is exact. They must
      // describe the same share, so the rounded percent cannot be 100 while
      // the ratio says less than 1 (or vice versa).
      expect(Math.min(Math.round(ratio * 100), 100)).toBeGreaterThanOrEqual(pct - 1);
      expect(Math.min(Math.round(ratio * 100), 100)).toBeLessThanOrEqual(pct + 1);
      if (pct === 100) expect(ratio).toBe(1);
    }
  });

  it("the live shape that motivated the fix reads 86%, not 99%", () => {
    // MYS-2311's real buckets. The old denominator (input + cacheRead)
    // reported 99% — the "99.5% rounds to 100%" trap on a run that actually
    // wrote 57K tokens into the cache.
    expect(cacheHitRatePercent(22, 341_623, 57_206)).toBe(86);
  });
});
