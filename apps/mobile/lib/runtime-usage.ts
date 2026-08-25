/**
 * Runtime usage cost math (iteration-93 MYS-676, extended iteration-103
 * MYS-712). Mirrors web's packages/views/runtimes/utils.ts: per-model pricing
 * (MODEL_PRICING), authoritative-vs-estimated cost split, cache savings, the
 * daily/weekly aggregates + window slicing + cost-by attribution + unmapped
 * model discovery that feed the runtime detail page's usage panel, and the
 * custom-pricing override store (lib/custom-pricing-store.ts) consulted after
 * the rate table, same order as web's resolvePricing.
 *
 * Values must agree with the web runtime detail page for the same rows.
 *
 * ES2023-only array methods (.toSorted, .findLastIndex) are avoided — the
 * app's Hermes runtime doesn't implement them (same constraint as
 * lib/usage-format.ts).
 */
import type { RuntimeUsage, RuntimeUsageByAgent } from "@multica/core/types";
import { getCustomPricing } from "./custom-pricing-store";

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

// Rate-table lookup, exact-match with the four tolerances above, then the
// custom-pricing override store (web resolvePricing parity: table candidates
// first, then user overrides for the same candidates). No startsWith fallback:
// unfamiliar variants like `gpt-5.5-mini` must have their own row to be
// priced. Provider qualifier (`cursor/auto`) tried first, then the bare key.
function resolveRuntimePricing(model: string, provider?: string) {
  if (!model) return undefined;
  const candidates = pricingCandidates(model, provider);
  for (const candidate of candidates) {
    const hit = MODEL_PRICING[candidate];
    if (hit) return hit;
  }
  for (const candidate of candidates) {
    const hit = getCustomPricing(candidate);
    if (hit) return hit;
  }
  return undefined;
}

/** Canonical storage/diagnostic key for a (model, provider) pair. */
export function pricingKey(model: string, provider?: string): string {
  const p = normalizeProvider(provider);
  return p ? qualify(p, model) : model;
}

/** Display/grouping key for a usage row's model (web modelGroupingKey parity):
 *  self-resolving ids stay bare, generic ids are provider-qualified. */
export function modelGroupingKey(model: string, provider?: string): string {
  if (!model) return normalizeProvider(provider) || "unknown";
  return isModelPriced(model) ? model : pricingKey(model, provider);
}

/** Whether a model id prices on its own (table or custom override). */
export function isModelPriced(model: string, provider?: string): boolean {
  return resolveRuntimePricing(model, provider) !== undefined;
}

/**
 * Unique, sorted list of pricing keys in `rows` that don't resolve to a
 * price. Provider-qualified when the row carries a provider. Rows the
 * provider priced in full are skipped (web collectUnmappedModels parity).
 */
export function collectUnmappedModels(rows: readonly Priceable[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    if (!r.model || isModelPriced(r.model, r.provider)) continue;
    const uncosted = uncostedTokens(r);
    const needsEstimate =
      uncosted.input > 0 ||
      uncosted.output > 0 ||
      uncosted.cacheRead > 0 ||
      uncosted.cacheWrite > 0;
    if (!needsEstimate && (r.cost_usd_ticks ?? 0) > 0) continue;
    set.add(pricingKey(r.model, r.provider));
  }
  return Array.from(set).sort();
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

// --- cost split + stacked series (iteration-103, web parity) ---------------

export interface CostBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Per-segment cost of a usage row (web estimateCostBreakdown parity). A row
 * with no rate-table pricing but an authoritative provider charge lands whole
 * in one bucket; a mixed row shapes the authoritative charge across segments
 * proportionally so the stack always sums back to estimateCost.
 */
export function estimateCostBreakdown(usage: Priceable): CostBreakdown {
  const pricing = resolveRuntimePricing(usage.model, usage.provider);
  if (!pricing) {
    return {
      input: (usage.cost_usd_ticks ?? 0) / COST_USD_TICKS_PER_USD,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    };
  }
  const uncosted = uncostedTokens(usage);
  const breakdown: CostBreakdown = {
    input: (uncosted.input * pricing.input) / 1_000_000,
    output: (uncosted.output * pricing.output) / 1_000_000,
    cacheRead: (uncosted.cacheRead * pricing.cacheRead) / 1_000_000,
    cacheWrite: (uncosted.cacheWrite * pricing.cacheWrite) / 1_000_000,
  };

  const authoritative = (usage.cost_usd_ticks ?? 0) / COST_USD_TICKS_PER_USD;
  if (authoritative <= 0) return breakdown;

  const shape = {
    input: ((usage.input_tokens - uncosted.input) * pricing.input) / 1_000_000,
    output: ((usage.output_tokens - uncosted.output) * pricing.output) / 1_000_000,
    cacheRead:
      ((usage.cache_read_tokens - uncosted.cacheRead) * pricing.cacheRead) / 1_000_000,
    cacheWrite:
      ((usage.cache_write_tokens - uncosted.cacheWrite) * pricing.cacheWrite) / 1_000_000,
  };
  const shapeTotal = shape.input + shape.output + shape.cacheRead + shape.cacheWrite;
  if (shapeTotal <= 0) {
    return { ...breakdown, input: breakdown.input + authoritative };
  }
  const scale = authoritative / shapeTotal;
  return {
    input: breakdown.input + shape.input * scale,
    output: breakdown.output + shape.output * scale,
    cacheRead: breakdown.cacheRead + shape.cacheRead * scale,
    cacheWrite: breakdown.cacheWrite + shape.cacheWrite * scale,
  };
}

// --- calendar helpers (web todayIso / addDaysIso / weekStartIso parity) -----

/** Today's calendar date (YYYY-MM-DD) in the given IANA timezone. */
export function todayIso(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Pure date arithmetic on a YYYY-MM-DD string (UTC math, DST-stable). */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Monday-of-week as YYYY-MM-DD (ISO 8601 week start). */
export function weekStartIso(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const day = dt.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const offset = (day + 6) % 7; // distance back to Monday
  dt.setUTCDate(dt.getUTCDate() - offset);
  return dt.toISOString().slice(0, 10);
}

export function diffDaysIso(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  const a = Date.UTC(y1 ?? 1970, (m1 ?? 1) - 1, d1 ?? 1);
  const b = Date.UTC(y2 ?? 1970, (m2 ?? 1) - 1, d2 ?? 1);
  return Math.round((b - a) / 86_400_000);
}

/** "May 12" — short English month/day, UTC-anchored (web formatShortDate). */
export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  return dt.toLocaleString("en", { month: "short", day: "numeric", timeZone: "UTC" });
}

// --- window slicing + delta (web sliceWindow / pctChange parity) ------------

/** Slice a daily-grain series into the selected window and the immediately
 *  prior window of equal length, anchored on today in the runtime tz. */
export function sliceWindow(
  usage: readonly RuntimeUsage[],
  days: number,
  tz: string,
): { filtered: RuntimeUsage[]; prevFiltered: RuntimeUsage[] } {
  const today = todayIso(tz);
  const isoCurrent = addDaysIso(today, -days);
  const isoPrev = addDaysIso(today, -days * 2);
  return {
    filtered: usage.filter((u) => u.date >= isoCurrent),
    prevFiltered: usage.filter((u) => u.date >= isoPrev && u.date < isoCurrent),
  };
}

/** Rounded percent change; null when the previous window is zero. */
export function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

// --- daily / weekly stacked series (web aggregateByDate / aggregateByWeek) --

export interface DailyTokenData {
  date: string;
  label: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface DailyCostStackData {
  date: string;
  label: string;
  input: number;
  output: number;
  cacheWrite: number;
  total: number;
}

export interface ModelDistribution {
  model: string;
  tokens: number;
  cost: number;
}

export interface WeeklyTokenData {
  weekStart: string;
  weekEnd: string;
  label: string;
  rangeLabel: string;
  partial: boolean;
  daysCovered: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface WeeklyCostStackData {
  weekStart: string;
  weekEnd: string;
  label: string;
  rangeLabel: string;
  partial: boolean;
  daysCovered: number;
  input: number;
  output: number;
  cacheWrite: number;
  total: number;
}

function formatDateLabel(d: string): string {
  const date = new Date(`${d}T00:00:00`);
  if (Number.isNaN(date.getTime())) return d;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** Per-(date, model) rows → daily tokens / cost-stack / cost / model-dist. */
export function aggregateByDate(usage: readonly RuntimeUsage[]): {
  dailyTokens: DailyTokenData[];
  dailyCost: DailyCostStackData[];
  dailyCostStack: DailyCostStackData[];
  modelDist: ModelDistribution[];
} {
  const dateMap = new Map<string, Omit<DailyTokenData, "label">>();
  const stackMap = new Map<string, { input: number; output: number; cacheWrite: number }>();
  const modelMap = new Map<string, { tokens: number; cost: number }>();

  for (const u of usage) {
    const existing = dateMap.get(u.date) ?? {
      date: u.date,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    };
    existing.input += u.input_tokens;
    existing.output += u.output_tokens;
    existing.cacheRead += u.cache_read_tokens;
    existing.cacheWrite += u.cache_write_tokens;
    dateMap.set(u.date, existing);

    const breakdown = estimateCostBreakdown(u);
    const stack = stackMap.get(u.date) ?? { input: 0, output: 0, cacheWrite: 0 };
    stack.input += breakdown.input;
    stack.output += breakdown.output;
    stack.cacheWrite += breakdown.cacheWrite;
    stackMap.set(u.date, stack);

    const modelName = modelGroupingKey(u.model, u.provider);
    const m = modelMap.get(modelName) ?? { tokens: 0, cost: 0 };
    m.tokens +=
      u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens;
    m.cost += estimateCost(u);
    modelMap.set(modelName, m);
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const dailyTokens = Array.from(dateMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ ...d, label: formatDateLabel(d.date) }));

  const dailyCostStack = Array.from(stackMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, s]) => {
      const input = round(s.input);
      const output = round(s.output);
      const cacheWrite = round(s.cacheWrite);
      return {
        date,
        label: formatDateLabel(date),
        input,
        output,
        cacheWrite,
        total: round(input + output + cacheWrite),
      };
    });

  const modelDist = Array.from(modelMap.entries())
    .map(([model, data]) => ({ model, ...data }))
    .sort((a, b) => b.tokens - a.tokens);

  return { dailyTokens, dailyCost: dailyCostStack, dailyCostStack, modelDist };
}

/**
 * Fold daily-grain rows into ISO calendar weeks (Mon–Sun), exactly
 * `weekCount` trailing weeks ending at the week containing today (in tz).
 * Buckets pre-zeroed so sparse/empty weeks render as zero bars; rows outside
 * the window are dropped. The current week is flagged partial (web
 * aggregateByWeek parity).
 */
export function aggregateByWeek(
  usage: readonly (Priceable & { date: string })[],
  tz: string,
  weekCount: number,
): {
  weeklyTokens: WeeklyTokenData[];
  weeklyCostStack: WeeklyCostStackData[];
} {
  const count = Math.max(1, Math.floor(weekCount));
  const today = todayIso(tz);
  const currentWeekStart = weekStartIso(today);
  const firstWeekStart = addDaysIso(currentWeekStart, -(count - 1) * 7);

  type TokenAgg = Omit<WeeklyTokenData, "label" | "rangeLabel" | "partial" | "daysCovered" | "weekEnd">;
  const tokenMap = new Map<string, TokenAgg>();
  const stackMap = new Map<string, { input: number; output: number; cacheWrite: number }>();

  for (let i = 0; i < count; i++) {
    const wkStart = addDaysIso(firstWeekStart, i * 7);
    tokenMap.set(wkStart, {
      weekStart: wkStart,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    stackMap.set(wkStart, { input: 0, output: 0, cacheWrite: 0 });
  }

  for (const u of usage) {
    const wkStart = weekStartIso(u.date);
    if (wkStart < firstWeekStart || wkStart > currentWeekStart) continue;
    const tokens = tokenMap.get(wkStart);
    if (!tokens) continue;
    tokens.input += u.input_tokens;
    tokens.output += u.output_tokens;
    tokens.cacheRead += u.cache_read_tokens;
    tokens.cacheWrite += u.cache_write_tokens;

    const breakdown = estimateCostBreakdown(u);
    const stack = stackMap.get(wkStart);
    if (!stack) continue;
    stack.input += breakdown.input;
    stack.output += breakdown.output;
    stack.cacheWrite += breakdown.cacheWrite;
  }

  const decorate = (weekStart: string) => {
    const weekEnd = addDaysIso(weekStart, 6);
    const partial = today < weekEnd;
    const elapsedDays = Math.min(
      7,
      Math.max(
        1,
        diffDaysIso(weekStart, today < weekStart ? weekStart : today < weekEnd ? today : weekEnd) + 1,
      ),
    );
    return {
      weekStart,
      weekEnd,
      label: formatShortDate(weekStart),
      rangeLabel: `${formatShortDate(weekStart)} – ${formatShortDate(weekEnd)}`,
      partial,
      daysCovered: partial ? elapsedDays : 7,
    };
  };

  const weeklyTokens: WeeklyTokenData[] = Array.from(tokenMap.values())
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map((t) => ({ ...t, ...decorate(t.weekStart) }));

  const round = (n: number) => Math.round(n * 100) / 100;
  const weeklyCostStack: WeeklyCostStackData[] = Array.from(stackMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, s]) => {
      const input = round(s.input);
      const output = round(s.output);
      const cacheWrite = round(s.cacheWrite);
      return {
        ...decorate(weekStart),
        input,
        output,
        cacheWrite,
        total: round(input + output + cacheWrite),
      };
    });

  return { weeklyTokens, weeklyCostStack };
}

// --- cost-by attribution (web aggregateCostByAgent / aggregateCostByModel) --

export interface CostByKey {
  key: string;
  tokens: number;
  cost: number;
  taskCount: number;
}

/** Per-(agent, model) rows → per-agent totals sorted by cost desc. */
export function aggregateCostByAgent(rows: readonly RuntimeUsageByAgent[]): CostByKey[] {
  const map = new Map<string, CostByKey>();
  for (const r of rows) {
    const entry = map.get(r.agent_id) ?? {
      key: r.agent_id,
      tokens: 0,
      cost: 0,
      taskCount: 0,
    };
    entry.tokens +=
      r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens;
    entry.cost += estimateCost(r);
    entry.taskCount += r.task_count;
    map.set(r.agent_id, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
}

/** Per-(date, model) rows → per-model totals sorted by cost desc. */
export function aggregateCostByModel(rows: readonly RuntimeUsage[]): CostByKey[] {
  const map = new Map<string, CostByKey>();
  for (const r of rows) {
    const key = modelGroupingKey(r.model, r.provider);
    const entry = map.get(key) ?? { key, tokens: 0, cost: 0, taskCount: 0 };
    entry.tokens +=
      r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens;
    entry.cost += estimateCost(r);
    map.set(key, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
}

// --- 26-week activity heatmap (web ActivityHeatmap math) --------------------

export interface HeatmapCell {
  date: string;
  dayOfWeek: number; // 0 = Mon ... 6 = Sun
  week: number;
  cost: number;
  level: number; // 0 = no activity, 1..4 ascending intensity
}

export interface HeatmapInsights {
  busiestDay: { date: string; cost: number } | null;
  busyDayIndex: number | null;
  busyDayAvg: number;
  quietDayIndex: number | null;
  quietDayAvg: number;
  totalCost: number;
  windowDays: number;
}

export interface HeatmapData {
  cells: HeatmapCell[];
  monthLabels: { label: string; week: number }[];
  insights: HeatmapInsights;
}

/**
 * Build the Mon-first activity grid: `weeks` trailing calendar weeks (default
 * 26) ending at the week containing today in `tz`. Day intensity is a
 * percentile of non-zero daily costs (web getHeatmapColor levels). Month
 * labels are emitted at Monday cells where the month changes, localized via
 * `locale` (default "en").
 */
export function computeHeatmapCells(
  usage: readonly RuntimeUsage[],
  tz: string,
  opts: { weeks?: number; locale?: string } = {},
): HeatmapData {
  const weekCount = Math.max(1, Math.floor(opts.weeks ?? 26));
  const locale = opts.locale ?? "en";
  const dateCost = new Map<string, number>();
  for (const u of usage) {
    dateCost.set(u.date, (dateCost.get(u.date) ?? 0) + estimateCost(u));
  }

  const today = todayIso(tz);
  const lastWeekStart = weekStartIso(today);
  const startDate = addDaysIso(lastWeekStart, -(weekCount - 1) * 7);

  // Monday-based weekday of a YYYY-MM-DD string: 0 = Mon ... 6 = Sun.
  const mondayIndex = (iso: string): number => {
    const [y, m, d] = iso.split("-").map(Number);
    return (new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay() + 6) % 7;
  };

  // Index of `today` in the flattened week grid; cells after it are skipped
  // (the in-progress week renders partially, like the Weekly chart).
  const todayIndex = (weekCount - 1) * 7 + mondayIndex(today);

  const allCells: Omit<HeatmapCell, "level">[] = [];
  for (let i = 0; i <= todayIndex; i++) {
    const dateStr = addDaysIso(startDate, i);
    allCells.push({
      date: dateStr,
      dayOfWeek: i % 7,
      week: Math.floor(i / 7),
      cost: dateCost.get(dateStr) ?? 0,
    });
  }

  const nonZero = allCells
    .filter((c) => c.cost > 0)
    .map((c) => c.cost)
    .sort((a, b) => a - b);
  const getLevel = (cost: number) => {
    if (cost === 0) return 0;
    if (nonZero.length <= 1) return 4;
    const p = nonZero.indexOf(cost) / (nonZero.length - 1);
    if (p <= 0.25) return 1;
    if (p <= 0.5) return 2;
    if (p <= 0.75) return 3;
    return 4;
  };

  const cells: HeatmapCell[] = allCells.map((c) => ({ ...c, level: getLevel(c.cost) }));

  const months: { label: string; week: number }[] = [];
  let lastMonth = -1;
  for (const c of cells) {
    const month = new Date(`${c.date}T00:00:00Z`).getUTCMonth();
    if (month !== lastMonth && c.dayOfWeek === 0) {
      months.push({
        label: new Date(`${c.date}T00:00:00Z`).toLocaleString(locale, { month: "short", timeZone: "UTC" }),
        week: c.week,
      });
      lastMonth = month;
    }
  }

  let busiestDay: { date: string; cost: number } | null = null;
  let totalCost = 0;
  const weekdaySum = [0, 0, 0, 0, 0, 0, 0];
  const weekdayCount = [0, 0, 0, 0, 0, 0, 0];
  for (const c of allCells) {
    totalCost += c.cost;
    weekdaySum[c.dayOfWeek] = (weekdaySum[c.dayOfWeek] ?? 0) + c.cost;
    weekdayCount[c.dayOfWeek] = (weekdayCount[c.dayOfWeek] ?? 0) + 1;
    if (c.cost > 0 && (!busiestDay || c.cost > busiestDay.cost)) {
      busiestDay = { date: c.date, cost: c.cost };
    }
  }
  const weekdayAvg = weekdaySum.map((s, i) => {
    const count = weekdayCount[i] ?? 0;
    return count > 0 ? s / count : 0;
  });
  let busyDayIndex: number | null = null;
  let busyDayAvg = 0;
  let quietDayIndex: number | null = null;
  let quietDayAvg = Number.POSITIVE_INFINITY;
  weekdayAvg.forEach((avg, i) => {
    if (avg > busyDayAvg) {
      busyDayAvg = avg;
      busyDayIndex = i;
    }
    if (avg < quietDayAvg) {
      quietDayAvg = avg;
      quietDayIndex = i;
    }
  });
  if (quietDayAvg === Number.POSITIVE_INFINITY) quietDayAvg = 0;
  if (totalCost === 0) {
    busyDayIndex = null;
    quietDayIndex = null;
  }

  const insights: HeatmapInsights = {
    busiestDay,
    busyDayIndex,
    busyDayAvg,
    quietDayIndex,
    quietDayAvg,
    totalCost,
    windowDays: allCells.length,
  };

  return { cells, monthLabels: months, insights };
}