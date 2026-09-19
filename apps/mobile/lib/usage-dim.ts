/**
 * Window and grain rules for the workspace usage screen (iteration 169).
 * Mirrors web's packages/views/dashboard/components/dashboard-shared.tsx
 * (TIME_RANGES / dimsForDays) and the fetch-window arithmetic in
 * dashboard-page.tsx (chartFetchDays / dailyCutoffIso).
 *
 * The range is the page-scoped filter and the dimension is card-scoped, so
 * the dependency runs one way only: a card offers whichever dimensions its
 * range allows and nothing resets. A card-scoped control must never reach up
 * and change a page-scoped one (web MUL-5759) — hence `effectiveDim` derives
 * the drawn grain instead of writing the correction back into state.
 *
 * Kept pure and free of React so the Node-only vitest lane can pin it.
 */
import { addDaysIso, todayIso, weekStartIso, formatShortDate, diffDaysIso } from "@/lib/runtime-usage";

export type Dim = "daily" | "weekly";

/**
 * Which chart dimensions each range may be drawn at, mirroring web's
 * TIME_RANGES. 1d / 7d at the weekly grain collapse to a single bar; 180d at
 * the daily grain is 180 unreadable bars. Unknown ranges fall back to daily
 * only — the narrowest reading, and the one every range supports.
 */
export function dimsForDays(days: number): readonly Dim[] {
  if (days === 30 || days === 90) return ["daily", "weekly"];
  if (days === 180) return ["weekly"];
  return ["daily"];
}

/**
 * The grain a card actually draws: the reader's choice when the range still
 * allows it, otherwise the range's first allowed dimension. Derived on every
 * render rather than corrected in state, so narrowing to 1d and widening back
 * to 30d restores the reader's choice instead of having forgotten it.
 */
export function effectiveDim(allowed: readonly Dim[], chosen: Dim): Dim {
  return allowed.includes(chosen) ? chosen : (allowed[0] ?? "daily");
}

/** Trailing calendar weeks that cover `days` days, at least one. */
export function weekCountForDays(days: number): number {
  return Math.max(1, Math.ceil(days / 7));
}

/**
 * How many days of per-date rows to fetch for a `days` window.
 *
 * Weekly bars need the whole calendar week the window starts inside, so a
 * 30d window's leftmost bar would otherwise be silently truncated to the days
 * that happen to fall in the window. Over-fetching to a whole number of weeks
 * costs a handful of rows; daily aggregations trim back to exactly `days`
 * client-side via `dailyCutoffIso`, so the extra rows change nothing they
 * show.
 *
 * Applied unconditionally, not only while a chart is weekly: the dimension is
 * a card-level control, so the page cannot know which grain is on screen —
 * and fetching for the wider of the two means flipping a card between Daily
 * and Weekly never refetches.
 */
export function chartFetchDays(days: number): number {
  return weekCountForDays(days) * 7;
}

/**
 * Oldest YYYY-MM-DD a daily surface may show for a `days` window, anchored on
 * the viewer's timezone — the same axis the server slices its day buckets on,
 * so it lands on the same calendar boundary. Applied in both dims so 1d
 * strictly means "today" even at the midnight edge where a wall-clock cutoff
 * would otherwise include yesterday.
 *
 * The per-agent rollups carry no date and cannot be trimmed this way; their
 * window is closed server-side at exactly `days` buckets, so anything derived
 * from them is already on the same span and must NOT be put on this cutoff —
 * that would widen the leaderboard and the Run time / Tasks KPIs by one day
 * while the chart and the Cost / Tokens KPIs beside them did not (web
 * MUL-5551).
 */
export function dailyCutoffIso(days: number, tz: string): string {
  return addDaysIso(todayIso(tz), -(days - 1));
}

/** Drop per-date rows that fall before the window's first day. */
export function trimToWindow<T extends { date: string }>(
  rows: readonly T[],
  cutoffIso: string,
): T[] {
  return rows.filter((r) => r.date >= cutoffIso);
}

/**
 * One trailing calendar week (Mon–Sun, ISO 8601 week start) in the viewer's
 * timezone, with the labels and partial-week metadata the weekly aggregators
 * decorate their rows with.
 */
export interface WeekShell {
  weekStart: string;
  weekEnd: string;
  label: string;
  rangeLabel: string;
  /** The week containing today is still running. */
  partial: boolean;
  /** Days of this week that have elapsed: 7 for a closed week, 1..6 for the current one. */
  daysCovered: number;
}

/**
 * Build `weekCount` trailing calendar week shells anchored at today-in-tz.
 * Pre-seeding every shell is what lets a sparse or empty week render as a zero
 * bar instead of being dropped, and what lets the aggregators discard rows
 * from the over-fetched partial week before the window.
 */
export function buildWeekShells(tz: string, weekCount: number): WeekShell[] {
  const count = Math.max(1, Math.floor(weekCount));
  const today = todayIso(tz);
  const currentWeekStart = weekStartIso(today);
  const firstWeekStart = addDaysIso(currentWeekStart, -(count - 1) * 7);
  const shells: WeekShell[] = [];
  for (let i = 0; i < count; i++) {
    const weekStart = addDaysIso(firstWeekStart, i * 7);
    const weekEnd = addDaysIso(weekStart, 6);
    const partial = today < weekEnd;
    const clampedToday =
      today < weekStart ? weekStart : today < weekEnd ? today : weekEnd;
    const elapsed = Math.min(7, Math.max(1, diffDaysIso(weekStart, clampedToday) + 1));
    shells.push({
      weekStart,
      weekEnd,
      label: formatShortDate(weekStart),
      rangeLabel: `${formatShortDate(weekStart)} – ${formatShortDate(weekEnd)}`,
      partial,
      daysCovered: partial ? elapsed : 7,
    });
  }
  return shells;
}
