/**
 * Per-run token/cost summarization for the runs sheet (issue detail → agent
 * runs). Mirrors web's collapse in `packages/views/runtimes/utils.ts`
 * (summarizeTaskUsage / estimateCost / formatUsd) so a run costs the same
 * number on both clients — one cost formula in the product.
 *
 * Like web's module this consults the custom-pricing override store after the
 * rate table, so a rate the user entered on the runtime usage page prices the
 * same run on the issue detail page too.
 *
 * Deliberate deviations from the web module, each noted at its site:
 *  - `TaskUsage` rows carry no `uncosted_*` split, so `estimateCost` treats a
 *    row as all-or-nothing: provider-reported cost wins whole, otherwise the
 *    whole row is priced from the table (matches web's `uncostedTokens`
 *    fallback for precisely this shape — see the TaskUsage docblock in
 *    `packages/core/types/agent.ts`)
 *
 * ES2023 array methods (`.toSorted` / `.findLastIndex`) are avoided per the
 * Hermes note in `lib/usage-format.ts`.
 */
import type { TaskUsage } from "@multica/core/types";
import { useCustomPricingStore, type CustomModelPricing } from "./custom-pricing-store";
import {
  pricingKey as sharedPricingKey,
  resolvePricing as resolvePricingFrom,
  type ModelPrice,
  type PricingOverrides,
} from "./model-pricing";

export type { ModelPrice };

/** Collapsed usage for one agent run, or for a set of runs. */
export interface TaskUsageSummary {
  /** input + output + cacheRead + cacheWrite, matching the usage page's headline. */
  tokens: number;
  cost: number;
  /** What cache reads would have cost at full input price minus the cache-hit
   *  rate — a reconstruction of "money the cache saved", not real spend. */
  cacheSavings: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Distinct models this run touched, in first-seen order. Usually one. */
  models: string[];
}

// Providers report cost in ticks of 1e-10 USD (xAI's unit), which keeps
// sub-cent turn costs exact as integers all the way from the agent to here.
const COST_USD_TICKS_PER_USD = 10_000_000_000;

/**
 * Collapse a run's per-model usage slices into one summary. Returns `null`
 * for both `undefined` and `[]`: neither means "this run was free", they
 * mean "we have no figure" and the UI must render an em dash, never 0.
 */
export function summarizeTaskUsage(
  usage: readonly TaskUsage[] | undefined,
): TaskUsageSummary | null {
  if (!usage || usage.length === 0) return null;

  const models: string[] = [];
  const summary: TaskUsageSummary = {
    tokens: 0,
    cost: 0,
    cacheSavings: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    models,
  };

  for (const slice of usage) {
    summary.input += slice.input_tokens;
    summary.output += slice.output_tokens;
    summary.cacheRead += slice.cache_read_tokens;
    summary.cacheWrite += slice.cache_write_tokens;
    summary.cost += estimateCost(slice);
    summary.cacheSavings += estimateCacheSavings(slice);
    if (slice.model && !models.includes(slice.model)) models.push(slice.model);
  }
  summary.tokens =
    summary.input + summary.output + summary.cacheRead + summary.cacheWrite;

  return summary;
}

/**
 * Sum many runs' usage into one figure — the issue-level total on the runs
 * header. Runs with no recorded usage contribute nothing and do not make the
 * total null; the total is null only when NO run has usage, i.e. when there
 * is genuinely nothing to show.
 */
export function summarizeTaskUsageAcross(
  runs: readonly (readonly TaskUsage[] | undefined)[],
): TaskUsageSummary | null {
  return summarizeTaskUsage(runs.flatMap((u) => u ?? []));
}

/**
 * Cost of one usage slice. `cost_usd_ticks` (the provider's own price,
 * 1e-10 USD) is authoritative when present — a real bill, nothing to
 * estimate. Otherwise the whole slice is priced from the table below;
 * models absent from the table cost 0 (never a guessed rate).
 */
export function estimateCost(slice: TaskUsage): number {
  const authoritative = (slice.cost_usd_ticks ?? 0) / COST_USD_TICKS_PER_USD;
  const pricing = resolvePricing(slice.model, slice.provider);
  if (!pricing || authoritative > 0) return authoritative;
  return (
    (slice.input_tokens * pricing.input +
      slice.output_tokens * pricing.output +
      slice.cache_read_tokens * pricing.cacheRead +
      slice.cache_write_tokens * pricing.cacheWrite) /
    1_000_000
  );
}

// Money rendering is the same function on every surface; it lives with the
// rate table so the issue side and the runtime side cannot format differently.
export { formatUsd } from "./model-pricing";

/**
 * What this slice's cache *reads* would have cost at full input pricing minus
 * what they actually cost at the discounted cache-hit rate. This is a
 * reconstruction of "money the cache saved you", not real-world spend, so it
 * is 0 for a model with no rate entry — no rate, no discount to price.
 * Provider-reported `cost_usd_ticks` does not change it: that is a bill for
 * the turn, while the discount is a rate-table fact (web parity).
 */
export function estimateCacheSavings(slice: TaskUsage): number {
  const pricing = resolvePricing(slice.model, slice.provider);
  if (!pricing) return 0;
  return (
    (slice.cache_read_tokens * pricing.input -
      slice.cache_read_tokens * pricing.cacheRead) /
    1_000_000
  );
}

/**
 * Canonical storage key for a (model, provider) pair: provider-qualified
 * when a provider is known, else the bare model. `collectUnmappedModels`
 * returns these, so `cursor/auto` from one provider never merges with a bare
 * `auto` from another in the "unmapped" note (web parity).
 */
export function pricingKey(model: string, provider?: string): string {
  return sharedPricingKey(model, provider);
}

/** Whether a model string resolves to a rate-table entry. */
export function isModelPriced(model: string, provider?: string): boolean {
  return resolvePricing(model, provider) !== undefined;
}

/**
 * Unique, sorted pricing keys among `rows` that do not resolve to a price —
 * the "we counted these tokens but not their cost" footnote list. A row the
 * provider priced in full (`cost_usd_ticks > 0` and nothing left to
 * estimate) must not raise the warning: its cost is already exact, and asking
 * for a rate would be asking the user to override a real bill with a guess.
 * Empty when everything is priced or there are no rows.
 */
export function collectUnmappedModels(rows: readonly TaskUsage[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    if (!r.model || isModelPriced(r.model, r.provider)) continue;
    // No `uncosted_*` split on the mobile wire, so a row counts as needing an
    // estimate whenever it carries any tokens (web's uncostedTokens fallback).
    const needsEstimate =
      r.input_tokens > 0 ||
      r.output_tokens > 0 ||
      r.cache_read_tokens > 0 ||
      r.cache_write_tokens > 0;
    if (!needsEstimate && (r.cost_usd_ticks ?? 0) > 0) continue;
    set.add(pricingKey(r.model, r.provider));
  }
  // Hermes has no Array.prototype.toSorted — sort a fresh array.
  return Array.from(set).sort();
}

// ---------------------------------------------------------------------------
// Pricing resolution — the rate table itself lives in ONE place now
// (`lib/model-pricing.ts`), mirrored verbatim from web's
// `packages/views/runtimes/utils.ts`. This module owns only what is specific
// to the issue side: collapsing a run's slices into one summary.
//
// Before iteration 268 this file carried its own 61-row copy of the table and
// its own candidate derivation, and so did `lib/runtime-usage.ts`. Both copies
// had drifted the same 88 rows behind upstream, which priced most live runs at
// $0 while web priced them. One table, one resolver — the two venues cannot
// disagree about what a run cost.
// ---------------------------------------------------------------------------

function resolvePricing(model: string, provider?: string): ModelPrice | undefined {
  // The custom-pricing overrides are read imperatively here (not passed in) so
  // this stays the same call shape the rest of the module and its tests use;
  // surfaces that must REPAINT on a saved override subscribe to the store
  // themselves (see lib/custom-pricing-wiring.test.ts).
  return resolvePricingFrom(model, provider, getCustomPricingState());
}

/** The store's snapshot, in the shape the shared resolver expects. */
function getCustomPricingState(): PricingOverrides {
  return useCustomPricingStore.getState().pricings;
}