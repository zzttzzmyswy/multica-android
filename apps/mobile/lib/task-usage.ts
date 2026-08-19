/**
 * Per-run token/cost summarization for the runs sheet (issue detail → agent
 * runs). Mirrors web's collapse in `packages/views/runtimes/utils.ts`
 * (summarizeTaskUsage / estimateCost / formatUsd) so a run costs the same
 * number on both clients — one cost formula in the product.
 *
 * Deliberate deviations from the web module, each noted at its site:
 *  - no custom-pricing store (web's custom-pricing-store is not ported; the
 *    runs sheet is display-only this round)
 *  - `TaskUsage` rows carry no `uncosted_*` split, so `estimateCost` treats a
 *    row as all-or-nothing: provider-reported cost wins whole, otherwise the
 *    whole row is priced from the table (matches web's `uncostedTokens`
 *    fallback for precisely this shape — see the TaskUsage docblock in
 *    `packages/core/types/agent.ts`)
 *  - `TaskUsageSummary` omits web's `cacheSavings` (nothing renders it here)
 *
 * ES2023 array methods (`.toSorted` / `.findLastIndex`) are avoided per the
 * Hermes note in `lib/usage-format.ts`.
 */
import type { TaskUsage } from "@multica/core/types";

/** Collapsed usage for one agent run, or for a set of runs. */
export interface TaskUsageSummary {
  /** input + output + cacheRead + cacheWrite, matching the usage page's headline. */
  tokens: number;
  cost: number;
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

// Cents below $100, whole dollars above — two decimals on a four-figure
// spend is noise, dropping them below $100 would round most single runs to
// $0. Web parity: packages/views/runtimes/utils.ts formatUsd.
export function formatUsd(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Pricing table — VERBATIM mirror of web's MODEL_PRICING
// (packages/views/runtimes/utils.ts). Keep in sync when providers release
// new models or adjust prices; mirror new entries there before adding them
// to this file.
// ---------------------------------------------------------------------------

interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const MODEL_PRICING: Record<string, ModelPrice> = {
  // -- Anthropic: current generation --
  "claude-sonnet-5":     { input: 2,    output: 10,   cacheRead: 0.20, cacheWrite: 2.50 },
  "claude-fable-5":     { input: 10,   output: 50,   cacheRead: 1.00, cacheWrite: 12.50 },
  "claude-opus-5":      { input: 5,    output: 25,   cacheRead: 0.50, cacheWrite: 6.25 },
  "claude-haiku-4-5":   { input: 1,    output: 5,    cacheRead: 0.10, cacheWrite: 1.25 },
  "claude-sonnet-4-5":  { input: 3,    output: 15,   cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-sonnet-4-6":  { input: 3,    output: 15,   cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-opus-4-5":    { input: 5,    output: 25,   cacheRead: 0.50, cacheWrite: 6.25 },
  "claude-opus-4-6":    { input: 5,    output: 25,   cacheRead: 0.50, cacheWrite: 6.25 },
  "claude-opus-4-7":    { input: 5,    output: 25,   cacheRead: 0.50, cacheWrite: 6.25 },
  "claude-opus-4-8":    { input: 5,    output: 25,   cacheRead: 0.50, cacheWrite: 6.25 },

  // -- Anthropic: pre-4.5 Opus (legacy tier) --
  "claude-opus-4-1":    { input: 15,   output: 75,   cacheRead: 1.50, cacheWrite: 18.75 },
  "claude-opus-4":      { input: 15,   output: 75,   cacheRead: 1.50, cacheWrite: 18.75 },

  // -- Anthropic: Sonnet 4.0 (deprecated) --
  "claude-sonnet-4":    { input: 3,    output: 15,   cacheRead: 0.30, cacheWrite: 3.75 },

  // -- Anthropic: older Haiku tier --
  "claude-haiku-3-5":   { input: 0.80, output: 4,    cacheRead: 0.08, cacheWrite: 1.00 },

  // -- OpenAI: Codex catalog SKUs (5.6+ bills cache writes separately) --
  "gpt-5.6-sol":        { input: 5,    output: 30,   cacheRead: 0.50,  cacheWrite: 6.25 },
  "gpt-5.6-terra":      { input: 2.50, output: 15,   cacheRead: 0.25,  cacheWrite: 3.125 },
  "gpt-5.6-luna":       { input: 1,    output: 6,    cacheRead: 0.10,  cacheWrite: 1.25 },
  "gpt-5.5":            { input: 5,    output: 30,   cacheRead: 0.50,  cacheWrite: 5 },
  "gpt-5.4-mini":       { input: 0.75, output: 4.50, cacheRead: 0.075, cacheWrite: 0.75 },
  "gpt-5.4":            { input: 2.50, output: 15,   cacheRead: 0.25,  cacheWrite: 2.50 },
  "gpt-5.3-codex":      { input: 1.75, output: 14,   cacheRead: 0.175, cacheWrite: 1.75 },

  // -- OpenAI: GPT-5 family --
  "gpt-5-codex":        { input: 1.25, output: 10,   cacheRead: 0.125, cacheWrite: 1.25 },
  "gpt-5-mini":         { input: 0.25, output: 2,    cacheRead: 0.025, cacheWrite: 0.25 },
  "gpt-5-nano":         { input: 0.05, output: 0.40, cacheRead: 0.005, cacheWrite: 0.05 },
  "gpt-5":              { input: 1.25, output: 10,   cacheRead: 0.125, cacheWrite: 1.25 },

  // -- OpenAI: o-series reasoning models --
  "o3-mini":            { input: 1.10, output: 4.40, cacheRead: 0.55,  cacheWrite: 1.10 },
  "o3":                 { input: 2,    output: 8,    cacheRead: 0.50,  cacheWrite: 2 },
  "o4-mini":            { input: 1.10, output: 4.40, cacheRead: 0.275, cacheWrite: 1.10 },

  // -- OpenAI: GPT-4o family (legacy) --
  "gpt-4o-mini":        { input: 0.15, output: 0.60, cacheRead: 0.075, cacheWrite: 0.15 },
  "gpt-4o":             { input: 2.50, output: 10,   cacheRead: 1.25,  cacheWrite: 2.50 },

  // -- DeepSeek --
  "deepseek-v4-flash":  { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0.14 },
  "deepseek-v4-pro":    { input: 1.74, output: 3.48, cacheRead: 0.0145, cacheWrite: 1.74 },
  "deepseek-chat":      { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0.14 },
  "deepseek-reasoner":  { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0.14 },

  // -- Moonshot Kimi --
  "kimi-k2.6":          { input: 0.95, output: 4.00, cacheRead: 0.16,   cacheWrite: 0.95 },

  // -- Zhipu z.ai (flash tiers priced 0 so they resolve instead of unmapping) --
  "glm-5.1":            { input: 1.4,  output: 4.4,  cacheRead: 0.26,   cacheWrite: 1.4 },
  "glm-5":              { input: 1.0,  output: 3.2,  cacheRead: 0.2,    cacheWrite: 1.0 },
  "glm-5-turbo":        { input: 1.2,  output: 4.0,  cacheRead: 0.24,   cacheWrite: 1.2 },
  "glm-4.7":            { input: 0.6,  output: 2.2,  cacheRead: 0.11,   cacheWrite: 0.6 },
  "glm-4.7-flashx":     { input: 0.07, output: 0.4,  cacheRead: 0.01,   cacheWrite: 0.07 },
  "glm-4.7-flash":      { input: 0,    output: 0,    cacheRead: 0,      cacheWrite: 0 },
  "glm-4.6":            { input: 0.6,  output: 2.2,  cacheRead: 0.11,   cacheWrite: 0.6 },
  "glm-4.5":            { input: 0.6,  output: 2.2,  cacheRead: 0.11,   cacheWrite: 0.6 },
  "glm-4.5-x":          { input: 2.2,  output: 8.9,  cacheRead: 0.45,   cacheWrite: 2.2 },
  "glm-4.5-air":        { input: 0.2,  output: 1.1,  cacheRead: 0.03,   cacheWrite: 0.2 },
  "glm-4.5-airx":       { input: 1.1,  output: 4.5,  cacheRead: 0.22,   cacheWrite: 1.1 },
  "glm-4.5-flash":      { input: 0,    output: 0,    cacheRead: 0,      cacheWrite: 0 },

  // -- xAI Grok (fallback tier; xAI reports its own per-turn price that
  //    estimateCost prefers, since these rates cannot express the 200K-token
  //    2x tier) --
  "grok-4.5":                     { input: 2,    output: 6,    cacheRead: 0.30, cacheWrite: 2 },
  "grok-4.3":                     { input: 1.25, output: 2.50, cacheRead: 0.20, cacheWrite: 1.25 },
  "grok-build-0.1":               { input: 1,    output: 2,    cacheRead: 0.20, cacheWrite: 1 },
  "grok-4.20-multi-agent-0309":   { input: 1.25, output: 2.50, cacheRead: 0.20, cacheWrite: 1.25 },
  "grok-4.20-0309-reasoning":     { input: 1.25, output: 2.50, cacheRead: 0.20, cacheWrite: 1.25 },
  "grok-4.20-0309-non-reasoning": { input: 1.25, output: 2.50, cacheRead: 0.20, cacheWrite: 1.25 },

  // -- Cursor Composer / Auto. Generic unprefixed ids are provider-qualified
  //    (`cursor/auto`) to avoid cross-provider collisions; the legacy
  //    fallback key `cursor` equals its provider name and stays bare. --
  "cursor/auto":              { input: 1.25, output: 6,    cacheRead: 0.25,   cacheWrite: 0 },
  "cursor/composer-2.5-fast": { input: 3,    output: 15,   cacheRead: 0.5,    cacheWrite: 0 },
  "cursor/composer-2.5":      { input: 0.5,  output: 2.5,  cacheRead: 0.2,    cacheWrite: 0 },
  "cursor/composer-2-fast":   { input: 1.5,  output: 7.5,  cacheRead: 0.35,   cacheWrite: 0 },
  "cursor/composer-2":        { input: 0.5,  output: 2.5,  cacheRead: 0.2,    cacheWrite: 0 },
  "cursor/composer-1.5":      { input: 3.5,  output: 17.5, cacheRead: 0.35,   cacheWrite: 0 },
  "cursor/composer-1":        { input: 1.25, output: 10,   cacheRead: 0.125,  cacheWrite: 0 },
  "cursor":                   { input: 3,    output: 15,   cacheRead: 0.5,    cacheWrite: 0 },
};

// ---------------------------------------------------------------------------
// Pricing resolution — faithful subset of web's resolvePricing: the lookup
// candidates in web order (raw → provider-stripped → claude dot↔dash →
// context-tag stripped → each date-stripped), provider-qualified keys tried
// first. Custom-pricing overrides are not ported (see header note).
// ---------------------------------------------------------------------------

function resolvePricing(model: string, provider?: string): ModelPrice | undefined {
  if (!model) return undefined;
  const candidates = pricingCandidates(model, provider);
  for (const candidate of candidates) {
    const hit = MODEL_PRICING[candidate];
    if (hit) return hit;
  }
  return undefined;
}

function normalizeProvider(provider?: string): string {
  return provider?.trim().toLowerCase() ?? "";
}

function qualify(provider: string, key: string): string {
  return key.startsWith(`${provider}/`) ? key : `${provider}/${key}`;
}

function pricingCandidates(model: string, provider?: string): string[] {
  const base = canonicalCandidates(model);
  const p = normalizeProvider(provider);
  if (!p) return base;
  return [...base.map((c) => qualify(p, c)), ...base];
}

function canonicalCandidates(model: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (s: string) => {
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  const stripDate = (s: string) =>
    s.replace(/-(20\d{2}-\d{2}-\d{2}|20\d{6}|latest)$/, "");
  const stripProvider = (s: string) => {
    const i = s.indexOf("/");
    return i > 0 && /^[a-z][a-z0-9_-]*$/i.test(s.slice(0, i)) ? s.slice(i + 1) : s;
  };
  // Only Anthropic IDs are dot↔dash equivalent; OpenAI separators are semantic.
  const canonAnthropic = (s: string) =>
    s.startsWith("claude-") ? s.replace(/\./g, "-") : s;
  const stripContextTag = (s: string) => s.replace(/\[[^\]]+\]$/, "");

  const raw = model;
  const noProvider = stripProvider(raw);
  const dashed = canonAnthropic(noProvider);
  const noTag = stripContextTag(dashed);

  push(raw);
  push(noProvider);
  push(dashed);
  push(noTag);
  push(stripDate(raw));
  push(stripDate(noProvider));
  push(stripDate(dashed));
  push(stripDate(noTag));
  return out;
}