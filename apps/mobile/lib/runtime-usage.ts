/**
 * Runtime usage cost math (iteration-93, MYS-676). Mirrors web's
 * packages/views/runtimes/utils.ts cost-estimation half: per-model pricing
 * (MODEL_PRICING), authoritative-vs-estimated cost split, cache savings, and
 * the daily aggregates that feed the runtime detail page's usage KPI cards +
 * trend chart. Values must agree with the web runtime detail page for the
 * same rows.
 *
 * Deliberately NO custom-pricing store: the mobile app does not yet surface
 * web's per-runtime custom-pricing dialog, so `resolveRuntimePricing` consults
 * the rate table only (authoritative `cost_usd_ticks` still wins for rows the
 * provider priced itself).
 *
 * ES2023-only array methods (.toSorted, .findLastIndex) are avoided — the
 * app's Hermes runtime doesn't implement them (same constraint as
 * lib/usage-format.ts).
 */
import type { RuntimeUsage } from "@multica/core/types";

export interface Priceable {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  provider?: string;
  cost_usd_ticks?: number;
  uncosted_input_tokens?: number;
  uncosted_output_tokens?: number;
  uncosted_cache_read_tokens?: number;
  uncosted_cache_write_tokens?: number;
}

// Providers report cost in ticks of 1e-10 USD (xAI's unit), which keeps
// sub-cent turn costs exact as integers all the way from the agent to here.
const COST_USD_TICKS_PER_USD = 10_000_000_000;

// Pricing per million tokens (USD). Values + providers copied verbatim from
// web packages/views/runtimes/utils.ts MODEL_PRICING (keep in sync when new
// models ship). Source of the tier columns (input / output / cached-read /
// cached-write $ per 1M tokens):
//
//   Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
//   OpenAI:    https://openai.com/api/pricing
//   DeepSeek:  https://api-docs.deepseek.com/quick_start/pricing
//   Moonshot:  https://www.kimi.com/resources/kimi-k2-6-pricing
//   Zhipu:     https://docs.z.ai/guides/overview/pricing
//   xAI:       https://docs.x.ai/developers/pricing
//
// `cursor/*` ids are provider-qualified because they're unprefixed generic
// names (`auto`, `composer-*`) that can collide across providers.
const MODEL_PRICING: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
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

  "claude-opus-4-1":    { input: 15,   output: 75,   cacheRead: 1.50, cacheWrite: 18.75 },
  "claude-opus-4":      { input: 15,   output: 75,   cacheRead: 1.50, cacheWrite: 18.75 },

  "claude-sonnet-4":    { input: 3,    output: 15,   cacheRead: 0.30, cacheWrite: 3.75 },

  "claude-haiku-3-5":   { input: 0.80, output: 4,    cacheRead: 0.08, cacheWrite: 1.00 },

  "gpt-5.6-sol":        { input: 5,    output: 30,   cacheRead: 0.50,  cacheWrite: 6.25 },
  "gpt-5.6-terra":      { input: 2.50, output: 15,   cacheRead: 0.25,  cacheWrite: 3.125 },
  "gpt-5.6-luna":       { input: 1,    output: 6,    cacheRead: 0.10,  cacheWrite: 1.25 },
  "gpt-5.5":            { input: 5,    output: 30,   cacheRead: 0.50,  cacheWrite: 5 },
  "gpt-5.4-mini":       { input: 0.75, output: 4.50, cacheRead: 0.075, cacheWrite: 0.75 },
  "gpt-5.4":            { input: 2.50, output: 15,   cacheRead: 0.25,  cacheWrite: 2.50 },
  "gpt-5.3-codex":      { input: 1.75, output: 14,   cacheRead: 0.175, cacheWrite: 1.75 },

  "gpt-5-codex":        { input: 1.25, output: 10,   cacheRead: 0.125, cacheWrite: 1.25 },
  "gpt-5-mini":         { input: 0.25, output: 2,    cacheRead: 0.025, cacheWrite: 0.25 },
  "gpt-5-nano":         { input: 0.05, output: 0.40, cacheRead: 0.005, cacheWrite: 0.05 },
  "gpt-5":              { input: 1.25, output: 10,   cacheRead: 0.125, cacheWrite: 1.25 },

  "o3-mini":            { input: 1.10, output: 4.40, cacheRead: 0.55,  cacheWrite: 1.10 },
  "o3":                 { input: 2,    output: 8,    cacheRead: 0.50,  cacheWrite: 2 },
  "o4-mini":            { input: 1.10, output: 4.40, cacheRead: 0.275, cacheWrite: 1.10 },

  "gpt-4o-mini":        { input: 0.15, output: 0.60, cacheRead: 0.075, cacheWrite: 0.15 },
  "gpt-4o":             { input: 2.50, output: 10,   cacheRead: 1.25,  cacheWrite: 2.50 },

  "deepseek-v4-flash":  { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0.14 },
  "deepseek-v4-pro":    { input: 1.74, output: 3.48, cacheRead: 0.0145, cacheWrite: 1.74 },
  "deepseek-chat":      { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0.14 },
  "deepseek-reasoner":  { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0.14 },

  "kimi-k2.6":          { input: 0.95, output: 4.00, cacheRead: 0.16,   cacheWrite: 0.95 },

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

  "grok-4.5":                     { input: 2,    output: 6,    cacheRead: 0.30, cacheWrite: 2 },
  "grok-4.3":                     { input: 1.25, output: 2.50, cacheRead: 0.20, cacheWrite: 1.25 },
  "grok-build-0.1":               { input: 1,    output: 2,    cacheRead: 0.20, cacheWrite: 1 },
  "grok-4.20-multi-agent-0309":   { input: 1.25, output: 2.50, cacheRead: 0.20, cacheWrite: 1.25 },
  "grok-4.20-0309-reasoning":     { input: 1.25, output: 2.50, cacheRead: 0.20, cacheWrite: 1.25 },
  "grok-4.20-0309-non-reasoning": { input: 1.25, output: 2.50, cacheRead: 0.20, cacheWrite: 1.25 },

  "cursor/auto":              { input: 1.25, output: 6,    cacheRead: 0.25,   cacheWrite: 0 },
  "cursor/composer-2.5-fast": { input: 3,    output: 15,   cacheRead: 0.5,    cacheWrite: 0 },
  "cursor/composer-2.5":      { input: 0.5,  output: 2.5,  cacheRead: 0.2,    cacheWrite: 0 },
  "cursor/composer-2-fast":   { input: 1.5,  output: 7.5,  cacheRead: 0.35,   cacheWrite: 0 },
  "cursor/composer-2":        { input: 0.5,  output: 2.5,  cacheRead: 0.2,    cacheWrite: 0 },
  "cursor/composer-1.5":      { input: 3.5,  output: 17.5, cacheRead: 0.35,   cacheWrite: 0 },
  "cursor/composer-1":        { input: 1.25, output: 10,   cacheRead: 0.125,  cacheWrite: 0 },
  "cursor":                   { input: 3,    output: 15,   cacheRead: 0.5,    cacheWrite: 0 },
};

/** Compact USD rendering — same rule as web ruuntimes formatUsd. */
export function formatUsd(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

// --- pricing resolution (web parity) --------------------------------------

function normalizeProvider(provider?: string): string {
  return provider?.trim().toLowerCase() ?? "";
}

function qualify(provider: string, key: string): string {
  return key.startsWith(`${provider}/`) ? key : `${provider}/${key}`;
}

const canonicalCandidatesCache = new Map<string, string[]>();

// Fallback-key derivation for a model string, in the same order as web:
// strip provider prefix → Anthropic dot→dash → trailing [1m] context tag →
// trailing date snapshot. OpenAI separators are semantic, so only `claude-*`
// gets the dot↔dash equivalence.
function canonicalCandidates(model: string): string[] {
  const cached = canonicalCandidatesCache.get(model);
  if (cached) return cached;
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
  canonicalCandidatesCache.set(model, out);
  return out;
}

function pricingCandidates(model: string, provider?: string): string[] {
  const base = canonicalCandidates(model);
  const p = normalizeProvider(provider);
  if (!p) return base;
  return [...base.map((c) => qualify(p, c)), ...base];
}

// Rate-table lookup, exact-match with the four tolerances above. No
// startsWith fallback: unfamiliar variants like `gpt-5.5-mini` must have
// their own row to be priced. Provider qualifier (`cursor/auto`) tried first,
// then the bare key. No custom-pricing store on mobile (see header note).
function resolveRuntimePricing(model: string, provider?: string) {
  if (!model) return undefined;
  const candidates = pricingCandidates(model, provider);
  for (const candidate of candidates) {
    const hit = MODEL_PRICING[candidate];
    if (hit) return hit;
  }
  return undefined;
}

// The tokens in a row that still need pricing from the rate table. A backend
// older than the cost split sends no `uncosted_*`: falling back to the full
// token counts reproduces pre-split behaviour, EXCEPT when the row already
// carries an authoritative cost (adding a full-token estimate would
// double-charge it).
function uncostedTokens(usage: Priceable): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
} {
  if (usage.uncosted_input_tokens === undefined) {
    if ((usage.cost_usd_ticks ?? 0) > 0) {
      return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    }
    return {
      input: usage.input_tokens,
      output: usage.output_tokens,
      cacheRead: usage.cache_read_tokens,
      cacheWrite: usage.cache_write_tokens,
    };
  }
  return {
    input: usage.uncosted_input_tokens,
    output: usage.uncosted_output_tokens ?? 0,
    cacheRead: usage.uncosted_cache_read_tokens ?? 0,
    cacheWrite: usage.uncosted_cache_write_tokens ?? 0,
  };
}

// Cost of a usage row: what the provider actually charged, plus a rate-table
// estimate for whatever it didn't charge for (web estimateCost parity).
export function estimateCost(usage: Priceable): number {
  const authoritative = (usage.cost_usd_ticks ?? 0) / COST_USD_TICKS_PER_USD;
  const pricing = resolveRuntimePricing(usage.model, usage.provider);
  if (!pricing) return authoritative;
  const uncosted = uncostedTokens(usage);
  return (
    authoritative +
    (uncosted.input * pricing.input +
      uncosted.output * pricing.output +
      uncosted.cacheRead * pricing.cacheRead +
      uncosted.cacheWrite * pricing.cacheWrite) /
      1_000_000
  );
}

// Cache-read savings vs charging cache reads at full input rate (web
// estimateCacheSavings parity — $0 when the model is unpriced).
export function estimateCacheSavings(usage: Priceable): number {
  const pricing = resolveRuntimePricing(usage.model, usage.provider);
  if (!pricing) return 0;
  const wouldHaveCost = (usage.cache_read_tokens * pricing.input) / 1_000_000;
  const actualCost = (usage.cache_read_tokens * pricing.cacheRead) / 1_000_000;
  return wouldHaveCost - actualCost;
}

// --- daily aggregation (web parity) ---------------------------------------

export interface RuntimeUsageTotals {
  cost: number;
  cacheSavings: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function computeRuntimeTotals(rows: readonly Priceable[]): RuntimeUsageTotals {
  return rows.reduce<RuntimeUsageTotals>(
    (acc, u) => ({
      cost: acc.cost + estimateCost(u),
      cacheSavings: acc.cacheSavings + estimateCacheSavings(u),
      input: acc.input + u.input_tokens,
      output: acc.output + u.output_tokens,
      cacheRead: acc.cacheRead + u.cache_read_tokens,
      cacheWrite: acc.cacheWrite + u.cache_write_tokens,
    }),
    { cost: 0, cacheSavings: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );
}

export interface UsageDailyCost {
  /** YYYY-MM-DD server bucket (already in runtime tz). */
  date: string;
  /** Short local label like "8/16" (web formatDateLabel parity). */
  label: string;
  cost: number;
  totalTokens: number;
}

function formatDateLabel(d: string): string {
  const date = new Date(`${d}T00:00:00`);
  if (Number.isNaN(date.getTime())) return d;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** Per-(date, model) rows → one row per date, ascending (web aggregateByDate). */
export function aggregateRuntimeCostByDate(usage: readonly RuntimeUsage[]): UsageDailyCost[] {
  const map = new Map<string, { cost: number; totalTokens: number }>();
  for (const u of usage) {
    const entry = map.get(u.date) ?? { cost: 0, totalTokens: 0 };
    entry.cost += estimateCost(u);
    entry.totalTokens +=
      u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens;
    map.set(u.date, entry);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, t]) => ({ date, label: formatDateLabel(date), ...t }));
}