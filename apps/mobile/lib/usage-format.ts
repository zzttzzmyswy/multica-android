/**
 * Usage-view presentation helpers. Mirrors web's dashboard preprocessing in
 * packages/views/dashboard/utils.ts (tokens must agree with the web /usage
 * page): per-(date, model) rows fold to per-date, per-(agent, model) rows
 * fold to per-agent, unknown agents collapse into the same sentinel buckets
 * web renders, and token counts format through the same K/M/B notation.
 *
 * ES2023 array methods (.toSorted / .findLastIndex, etc.) are avoided: the
 * app's Hermes runtime doesn't implement them, so the code below uses the
 * ES5-era equivalents (.sort, an explicit reverse index loop).
 *
 * Behavior-parity points with web:
 *  - aggregateDailyTokens / aggregateDailyCost sort dates ascending (chart
 *    x-axis oldest→newest)
 *  - computeDailyTotals sums task_count across rows (an accepted KPI
 *    approximation — a task spanning two days/models counts twice, same as web)
 *    and cost via estimateCost (authoritative ticks + rate-table estimate)
 *  - deleted/restricted spend folding now lives in lib/usage-time.ts
 *    (bucketAgentDashboardRows), which carries the merged token+run-time rows
 */
import type { DashboardUsageByAgent, DashboardUsageDaily } from "@multica/core/types";
import { estimateCost, estimateCostBreakdown } from "./runtime-usage";

export interface UsageDailyAggregate {
  /** YYYY-MM-DD server bucket (already in workspace tz). */
  date: string;
  /** Short local label like "8/16", mirrors web formatDateLabel. */
  label: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  taskCount: number;
  /** Whole-window cost (authoritative + rate-table estimate), USD. */
  cost: number;
}

export interface AgentUsageRow {
  agentId: string;
  tokens: number;
  taskCount: number;
  /** Per-agent cost (authoritative + estimated), USD (web leaderboard parity). */
  cost: number;
}

/** Sentinel the SERVER emits for the bucket of agents it refuses to name. */
export const RESTRICTED_AGENTS_ROW_ID = "__restricted_agents__";

/** Mobile-side bucket for agents hard-deleted from the workspace. */
export const DELETED_AGENTS_ROW_ID = "__deleted_agents__";

export function isSyntheticAgentRow(agentId: string): boolean {
  return agentId === DELETED_AGENTS_ROW_ID || agentId === RESTRICTED_AGENTS_ROW_ID;
}

/**
 * Active-agent KPI: distinct agents with recorded usage in the window.
 * Synthetic buckets (server-restricted / hard-deleted) carry no agent id to
 * name and are excluded — the count is a visible minimum, honest about rows
 * the server refuses to attribute. Rows with zero tokens (agents whose only
 * movement was a failed run) don't count as "active".
 */
export function activeAgentCount(rows: AgentUsageRow[]): number {
  return rows.filter((r) => r.tokens > 0 && !isSyntheticAgentRow(r.agentId)).length;
}

const TOKEN_UNITS = [
  { divisor: 1, suffix: "" },
  { divisor: 1_000, suffix: "K" },
  { divisor: 1_000_000, suffix: "M" },
  { divisor: 1_000_000_000, suffix: "B" },
  { divisor: 1_000_000_000_000, suffix: "T" },
] as const;

/** Compact token count ("12.3K", "84.6M") — same rule as web formatTokens. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const magnitude = Math.abs(n);
  // Hermes has no Array.prototype.findLastIndex — walk backwards ourselves.
  let unitIndex = TOKEN_UNITS.length - 1;
  while (unitIndex > 0 && TOKEN_UNITS[unitIndex]!.divisor > magnitude) {
    unitIndex--;
  }
  if (unitIndex === 0) return n.toLocaleString();
  let unit = TOKEN_UNITS[unitIndex]!;
  let scaled = n / unit.divisor;
  // Promote 999,999.5+ → "1M" instead of "1000K" (web parity).
  if (Math.abs(Number(scaled.toFixed(1))) >= 1_000 && unitIndex < TOKEN_UNITS.length - 1) {
    unit = TOKEN_UNITS[unitIndex + 1]!;
    scaled = n / unit.divisor;
  }
  return `${Number(scaled.toFixed(1))}${unit.suffix}`;
}

export function formatDateLabel(d: string): string {
  // Anchor to local midnight so the label matches the workspace-tz bucket the
  // server picked; `new Date(d)` would parse as UTC and shift by the offset.
  const date = new Date(`${d}T00:00:00`);
  if (Number.isNaN(date.getTime())) return d;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** Per-(date, model) rows → one row per date, ascending. */
export function aggregateDailyTokens(
  usage: DashboardUsageDaily[],
): UsageDailyAggregate[] {
  const map = new Map<string, Omit<UsageDailyAggregate, "date" | "label">>();
  for (const u of usage) {
    const entry = map.get(u.date) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    entry.input += u.input_tokens;
    entry.output += u.output_tokens;
    entry.cacheRead += u.cache_read_tokens;
    entry.cacheWrite += u.cache_write_tokens;
    entry.total += u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens;
    map.set(u.date, entry);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, t]) => ({ date, label: formatDateLabel(date), ...t }));
}

export interface DailyCostRow {
  /** YYYY-MM-DD server bucket (already in workspace tz). */
  date: string;
  /** Short local label like "8/16", mirrors web formatDateLabel. */
  label: string;
  input: number;
  output: number;
  cacheWrite: number;
  total: number;
}

/** Whole-window totals for the KPI tiles (token rollup, tasks are KPI-approx). */
export function computeDailyTotals(usage: DashboardUsageDaily[]): UsageTotals {
  return usage.reduce<UsageTotals>(
    (acc, u) => ({
      input: acc.input + u.input_tokens,
      output: acc.output + u.output_tokens,
      cacheRead: acc.cacheRead + u.cache_read_tokens,
      cacheWrite: acc.cacheWrite + u.cache_write_tokens,
      total:
        acc.total + u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens,
      taskCount: acc.taskCount + u.task_count,
      cost: acc.cost + estimateCost(u),
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, taskCount: 0, cost: 0 },
  );
}

/**
 * Per-(date, model) rows → one row per date with cost broken into the three
 * segments the stacked bar / breakdown rows consume (web aggregateDailyCost
 * parity). Segments round to 2 decimals; unpriced rows land as an
 * authoritative charge whole in the input bucket.
 */
export function aggregateDailyCost(usage: DashboardUsageDaily[]): DailyCostRow[] {
  const map = new Map<string, { input: number; output: number; cacheWrite: number }>();
  for (const u of usage) {
    const b = estimateCostBreakdown(u);
    const entry = map.get(u.date) ?? { input: 0, output: 0, cacheWrite: 0 };
    entry.input += b.input;
    entry.output += b.output;
    entry.cacheWrite += b.cacheWrite;
    map.set(u.date, entry);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, s]) => {
      const round = (n: number) => Math.round(n * 100) / 100;
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
}

/**
 * Per-(agent, model) rows → one row per agent, tokens desc so the heaviest
 * spender lands first (cost rides along — the leaderboard re-ranks by
 * whichever metric the reader picks).
 */
export function aggregateByAgent(rows: DashboardUsageByAgent[]): AgentUsageRow[] {
  const map = new Map<string, AgentUsageRow>();
  for (const r of rows) {
    const entry = map.get(r.agent_id) ?? { agentId: r.agent_id, tokens: 0, taskCount: 0, cost: 0 };
    entry.tokens += r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens;
    entry.taskCount += r.task_count;
    entry.cost += estimateCost(r);
    map.set(r.agent_id, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.tokens - a.tokens);
}