/**
 * Usage-view presentation helpers. Mirrors web's dashboard preprocessing in
 * packages/views/dashboard/utils.ts (tokens must agree with the web /usage
 * page): per-(date, model) rows fold to per-date, per-(agent, model) rows
 * fold to per-agent, unknown agents collapse into the same sentinel buckets
 * web renders, and token counts format through the same K/M/B notation.
 *
 * Behavior-parity points with web:
 *  - aggregateDailyTokens sorts dates ascending (chart x-axis oldest→newest)
 *  - computeDailyTotals sums task_count across rows (an accepted KPI
 *    approximation — a task spanning two days/models counts twice, same as web)
 *  - bucketUnknownAgentRows keeps deleted/restricted spend visible instead of
 *    dropping it so per-agent rows reconcile with the KPI totals (MUL-3776)
 */
import type { DashboardUsageByAgent, DashboardUsageDaily } from "@multica/core/types";

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
}

export interface AgentUsageRow {
  agentId: string;
  tokens: number;
  taskCount: number;
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
  let unitIndex = TOKEN_UNITS.findLastIndex(({ divisor }) => magnitude >= divisor);
  unitIndex = Math.max(unitIndex, 0);
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

function formatDateLabel(d: string): string {
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
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([date, t]) => ({ date, label: formatDateLabel(date), ...t }));
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
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, taskCount: 0 },
  );
}

/**
 * Per-(agent, model) rows → one row per agent, tokens desc so the heaviest
 * spender lands first. Sorted by tokens: this backend reports cost zero
 * (uncosted), which is web's cost-desc tiebreaker exhausted to the same order.
 */
export function aggregateByAgent(rows: DashboardUsageByAgent[]): AgentUsageRow[] {
  const map = new Map<string, AgentUsageRow>();
  for (const r of rows) {
    const entry = map.get(r.agent_id) ?? { agentId: r.agent_id, tokens: 0, taskCount: 0 };
    entry.tokens += r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens;
    entry.taskCount += r.task_count;
    map.set(r.agent_id, entry);
  }
  return Array.from(map.values()).toSorted((a, b) => b.tokens - a.tokens);
}

/**
 * Fold usage rows whose agent no longer exists into one "Deleted agents" row
 * instead of dropping them (parity: MUL-3776). Rows from the server's
 * restricted bucket pass through named. `knownAgentIds` null (agent list still
 * loading) → pass through untouched rather than collapsing into one bucket.
 */
export function bucketUnknownAgentRows(
  rows: AgentUsageRow[],
  knownAgentIds: ReadonlySet<string> | null,
): AgentUsageRow[] {
  if (!knownAgentIds) return rows;
  const known: AgentUsageRow[] = [];
  const bucket: AgentUsageRow = { agentId: DELETED_AGENTS_ROW_ID, tokens: 0, taskCount: 0 };
  let hasDeleted = false;
  for (const r of rows) {
    if (knownAgentIds.has(r.agentId) || r.agentId === RESTRICTED_AGENTS_ROW_ID) {
      known.push(r);
      continue;
    }
    hasDeleted = true;
    bucket.tokens += r.tokens;
    bucket.taskCount += r.taskCount;
  }
  return hasDeleted ? [...known, bucket] : known;
}