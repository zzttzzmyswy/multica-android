/**
 * Errors-view (usage page Errors tab) aggregation helpers. Mirrors web's
 * dashboard failure preprocessing in packages/views/dashboard/utils.ts so the
 * KPI counts / class mix / offender ranking agree with the web /usage Errors
 * tab.
 *
 * ES2023 array methods (.toSorted) are avoided: the app's Hermes runtime
 * doesn't implement them, so the code below uses the ES5-era equivalents
 * (.sort / .map over entries).
 *
 * Behavior-parity points with web:
 *  - the empty `failure_reason` string is the *succeeded* bucket: it moves
 *    `total` only, never `failed` or a class
 *  - unknown reasons (a newer backend) fall through to the "other" class so
 *    the class totals always reconcile with the raw failure count
 *  - agents the viewer cannot resolve to a name fold into one
 *    UNRESOLVED_AGENTS_ROW_ID bucket so the list never renders a bare UUID
 */
import type { DashboardFailureByAgent, DashboardFailureDaily } from "@multica/core/types";
import { FAILURE_CLASSES, classForReason, type FailureClass } from "@/lib/failure-class";
import { formatDateLabel } from "@/lib/usage-format";

export type FailureClassCounts = Record<FailureClass, number>;

export function emptyClassCounts(): FailureClassCounts {
  return Object.fromEntries(
    FAILURE_CLASSES.map((c) => [c, 0]),
  ) as FailureClassCounts;
}

export interface FailureTotals {
  failed: number;
  total: number;
  rate: number;
}

// Fold one rollup row into a mutable accumulator. `failure_reason: ""` is the
// succeeded bucket: it moves `total` only, never `failed` or a class.
function foldFailureRow(
  acc: FailureClassCounts & { failed: number; total: number },
  reason: string,
  count: number,
): void {
  acc.total += count;
  if (reason === "") return;
  acc.failed += count;
  acc[classForReason(reason)] += count;
}

export interface DailyErrorsRow extends FailureClassCounts {
  /** YYYY-MM-DD server bucket (already in workspace tz). */
  date: string;
  /** Short local label like "8/16". */
  label: string;
  failed: number;
  total: number;
}

// Per-(date, reason) rows → one row per date with per-class failure counts (as
// flat fields, matching web's FailureClassCounts & FailureBucketTotals shape)
// and the day's failed / total totals. Sorted date asc so the chart x-axis
// reads oldest-to-newest, matching the other daily aggregators.
export function aggregateDailyErrors(rows: DashboardFailureDaily[]): DailyErrorsRow[] {
  const map = new Map<string, FailureClassCounts & { failed: number; total: number }>();
  for (const r of rows) {
    let entry = map.get(r.date);
    if (!entry) {
      entry = { ...emptyClassCounts(), failed: 0, total: 0 };
      map.set(r.date, entry);
    }
    foldFailureRow(entry, r.failure_reason, r.task_count);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ ...counts, date, label: formatDateLabel(date) }));
}

// Monday of the week a YYYY-MM-DD bucket falls in, as a YYYY-MM-DD string.
// The rows are already bucketed in the workspace timezone, so no tz math is
// needed here — comparing calendar dates is exact.
function weekStartIso(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const weekday = day.getUTCDay();
  const backToMonday = (weekday + 6) % 7;
  day.setUTCDate(day.getUTCDate() - backToMonday);
  const yy = day.getUTCFullYear();
  const mm = String(day.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(day.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export interface WeeklyErrorsRow extends FailureClassCounts {
  /** YYYY-MM-DD of the Monday that starts the week. */
  weekStart: string;
  /** Short local label of the week start, e.g. "8/10". */
  label: string;
  failed: number;
  total: number;
}

// Per-(date, reason) rows → one row per calendar week (Mon–Sun, anchored to
// the row dates) with the week's class counts and failed / total totals.
// Sorted week-asc for the weekly trend.
export function aggregateWeeklyErrors(rows: DashboardFailureDaily[]): WeeklyErrorsRow[] {
  const map = new Map<string, FailureClassCounts & { failed: number; total: number }>();
  for (const r of rows) {
    const wk = weekStartIso(r.date);
    let entry = map.get(wk);
    if (!entry) {
      entry = { ...emptyClassCounts(), failed: 0, total: 0 };
      map.set(wk, entry);
    }
    foldFailureRow(entry, r.failure_reason, r.task_count);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, counts]) => ({ ...counts, weekStart, label: formatDateLabel(weekStart) }));
}

// Whole-window failure totals for the Errors KPIs. `rate` is a fraction in
// [0, 1]; 0 when the window has no terminal tasks at all.
export function computeFailureTotals(
  rows: DashboardFailureDaily[],
): FailureTotals {
  let failed = 0;
  let total = 0;
  for (const r of rows) {
    total += r.task_count;
    if (r.failure_reason !== "") failed += r.task_count;
  }
  return { failed, total, rate: total > 0 ? failed / total : 0 };
}

export interface FailureClassRow {
  failureClass: FailureClass;
  count: number;
}

// Per-class window totals, heaviest first, zero-count classes dropped. Ties
// break on FAILURE_CLASSES order so the list doesn't reshuffle between
// renders when two classes sit at the same count.
export function aggregateFailureClasses(
  rows: { failure_reason: string; task_count: number }[],
): FailureClassRow[] {
  const counts = emptyClassCounts();
  for (const r of rows) {
    if (r.failure_reason === "") continue;
    counts[classForReason(r.failure_reason)] += r.task_count;
  }
  return FAILURE_CLASSES.map((failureClass) => ({
    failureClass,
    count: counts[failureClass],
  }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || FAILURE_CLASSES.indexOf(a.failureClass) - FAILURE_CLASSES.indexOf(b.failureClass));
}

export interface FailureReasonRow {
  reason: string;
  failureClass: FailureClass;
  count: number;
}

// Per-raw-reason window totals, heaviest first. This is the row set that
// answers "which specific error", under the coarser class summary.
export function aggregateFailureReasons(
  rows: { failure_reason: string; task_count: number }[],
): FailureReasonRow[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.failure_reason === "") continue;
    counts.set(r.failure_reason, (counts.get(r.failure_reason) ?? 0) + r.task_count);
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => ({
      reason,
      failureClass: classForReason(reason),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

// Synthetic agentId for the row aggregating every agent the viewer can't
// resolve to a name: hard-deleted agents plus the server's already-anonymized
// restricted bucket (`__restricted_agents__`, MUL-5409). The Errors card
// labels it neutrally ("Other agents"), which is honest for both.
export const UNRESOLVED_AGENTS_ROW_ID = "__unresolved_agents__";

// Sentinel the SERVER emits for the bucket of agents it refuses to name —
// kept exported so row rendering can recognise it if it ever passes through
// un-folded (no agent list supplied).
export function isUnresolvedAgentRow(agentId: string): boolean {
  return agentId === UNRESOLVED_AGENTS_ROW_ID;
}

export interface AgentFailureRow {
  agentId: string;
  failed: number;
  total: number;
  rate: number;
  /** Full per-class split; every class present (0 when unused). */
  classes: FailureClassCounts;
}

// Per-agent failure totals, worst first (absolute failure count). The rate
// rides along on the row, and `sortAgentFailures` can re-rank on it. Agents
// with zero failures are dropped — this list is a triage aid, not a census.
//
// When `agents` is supplied, rows whose agent no longer exists — or that the
// viewer cannot resolve — fold into one UNRESOLVED_AGENTS_ROW_ID bucket so
// the list never renders a bare UUID (web parity: anonymizeUnresolvedAgentRows
// + aggregateAgentFailures). `null` means "agent list still loading": rows
// pass through untouched.
export function aggregateAgentFailures(
  rows: DashboardFailureByAgent[],
  agents?: { id: string }[] | null,
): AgentFailureRow[] {
  const known = agents ? new Set(agents.map((a) => a.id)) : null;
  const resolve = (id: string): string => {
    if (!known) return id;
    return known.has(id) ? id : UNRESOLVED_AGENTS_ROW_ID;
  };

  const map = new Map<
    string,
    { failed: number; total: number; classes: FailureClassCounts }
  >();
  for (const r of rows) {
    const agentId = resolve(r.agent_id);
    let entry = map.get(agentId);
    if (!entry) {
      entry = { failed: 0, total: 0, classes: emptyClassCounts() };
      map.set(agentId, entry);
    }
    entry.total += r.task_count;
    if (r.failure_reason === "") continue;
    entry.failed += r.task_count;
    entry.classes[classForReason(r.failure_reason)] += r.task_count;
  }
  return sortAgentFailures(
    Array.from(map.entries())
      .filter(([, v]) => v.failed > 0)
      .map(([agentId, v]) => ({
        agentId,
        failed: v.failed,
        total: v.total,
        rate: v.total > 0 ? v.failed / v.total : 0,
        classes: v.classes,
      })),
    "failed",
  );
}

// Which metric ranks the offender list, and therefore how long its bars are
// (mirrors web's OffenderSort contract — sort metric, bar length and the
// emphasised column move together).
export type OffenderSort = "failed" | "rate";

export const OFFENDER_METRIC: Record<OffenderSort, (r: AgentFailureRow) => number> = {
  failed: (r) => r.failed,
  rate: (r) => r.rate,
};

// Minimum terminal runs before an agent's failure rate is allowed to compete
// on the Rate ranking. One run that failed is a 100% rate, and without a
// floor that row wins outright. Small-sample rows are demoted, NOT hidden.
export const MIN_RATE_SAMPLE = 10;

export function hasRateSample(row: AgentFailureRow): boolean {
  return row.total >= MIN_RATE_SAMPLE;
}

// Re-rank the offender rows for the selected metric. Ties break on the other
// metric so an equal-valued bucket keeps a stable, meaningful order instead
// of reshuffling on every render.
export function sortAgentFailures(
  rows: AgentFailureRow[],
  sortBy: OffenderSort,
): AgentFailureRow[] {
  if (sortBy === "failed") {
    return rows.sort((a, b) => b.failed - a.failed || b.rate - a.rate);
  }
  const sample = (r: AgentFailureRow) => (hasRateSample(r) ? 0 : 1);
  return rows.sort((a, b) => sample(a) - sample(b) || b.rate - a.rate || b.failed - a.failed);
}

// Failure rate as a percentage of terminal tasks — "12.5%", "40%". A bucket
// with no terminal tasks at all renders a dash rather than a 0%.
export function formatRate(failed: number, total: number): string {
  if (total <= 0) return "—";
  const pct = (failed / total) * 100;
  return `${pct >= 10 || pct === 0 ? Math.round(pct) : pct.toFixed(1)}%`;
}

/**
 * Per-scheme class colours, mixing the given `destructive` colour toward the
 * given `card` colour. Web draws the seven classes as a step down a
 * destructive ramp mixed toward the card colour
 * (packages/views/runtimes/components/charts/failure-class-visuals.ts); the
 * same ramp is reproduced here in plain HSL so the mobile "pure RN View" bars
 * keep the "reads as errors" look — darkest (strongest) segment first,
 * catchall lightest — in both light and dark mode.
 *
 * Callers pass THEME[colorScheme].destructive / .card; taking them as inputs
 * keeps this module free of react-native imports so the Node vitest lane can
 * test it.
 */
/** Destructive weight per class, most-actionable first (web parity). */
const CLASS_DESTRUCTIVE_WEIGHT: Record<FailureClass, number> = {
  auth: 1,
  rate_limit: 0.86,
  timeout: 0.72,
  provider: 0.6,
  runtime: 0.48,
  agent: 0.38,
  other: 0.3,
};

interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** Parse "hsl(0 84.2% 60.2%)" — the format THEME tokens are written in. */
export function parseHsl(input: string): Hsl | null {
  const m = /^hsl\((\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\)$/.exec(input);
  if (!m) return null;
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

// Interpolate `from` toward `to` by `share` (0 = from, 1 = to).
function mix(a: Hsl, b: Hsl, share: number): Hsl {
  const lerp = (x: number, y: number) => Math.round((x + (y - x) * share) * 10) / 10;
  return { h: lerp(a.h, b.h), s: lerp(a.s, b.s), l: lerp(a.l, b.l) };
}

function formatHsl({ h, s, l }: Hsl): string {
  return `hsl(${h} ${s}% ${l}%)`;
}

export function failureClassColors(
  destructive: string,
  card: string,
): Record<FailureClass, string> {
  const from = parseHsl(destructive);
  const to = parseHsl(card);
  if (!from || !to) {
    return Object.fromEntries(
      FAILURE_CLASSES.map((c) => [c, destructive]),
    ) as Record<FailureClass, string>;
  }
  return Object.fromEntries(
    FAILURE_CLASSES.map((c) => [c, formatHsl(mix(from, to, 1 - CLASS_DESTRUCTIVE_WEIGHT[c]))]),
  ) as Record<FailureClass, string>;
}