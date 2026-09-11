/**
 * Gantt canvas geometry + filtering rules — pure, timezone-safe, unit
 * tested. Mirrors web `packages/views/issues/components/gantt-view.tsx`
 * (UTC-day alignment, computeRange padding, inverted-date normalization,
 * single-date diamond marker) and `ganttCanvasRows`
 * (packages/views/issues/surface/use-issue-surface-data.ts:44-49).
 *
 * Same-N parity rule (apps/mobile/CLAUDE.md): the same issue set fed to
 * web's GanttView must produce the same visible rows and the same bar
 * placement here. Issue dates are date-only "YYYY-MM-DD" strings (see
 * @multica/core/issues/date) — everything anchors to UTC midnight so a
 * day maps to exactly one column regardless of the viewer's timezone.
 */
import type { Issue } from "@multica/core/types";

/** Gantt timeline zoom — mirrors web `GanttZoom`. */
export type GanttZoom = "day" | "week" | "month";

/** Pixels per day per zoom tier — web DAY_PX_BY_ZOOM (gantt-view.tsx:75). */
export const DAY_PX_BY_ZOOM: Record<GanttZoom, number> = {
  day: 36,
  week: 14,
  month: 6,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface GanttRange {
  start: Date;
  end: Date;
}

/** "YYYY-MM-DD" (or a legacy full ISO timestamp) → UTC-midnight Date;
 *  null when absent or unparseable. Same parse as
 *  @multica/core/issues/date `dateOnlyToUTCDate`. */
export function utcDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) {
    return new Date(
      Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
    );
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

export function startOfDayUTC(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

export function addDaysUTC(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}

/** Whole-day count from `a` to `b` (b later ⇒ positive). UTC has no DST,
 *  so the ms ratio is always a whole day on midnight-anchored inputs. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

export function isWeekendUTC(d: Date): boolean {
  const wd = d.getUTCDay();
  return wd === 0 || wd === 6;
}

export function isWeekStartUTC(d: Date): boolean {
  return d.getUTCDay() === 1; // Monday
}

export function isMonthStartUTC(d: Date): boolean {
  return d.getUTCDate() === 1;
}

/** True when both dates exist and start is strictly after due — the
 *  anomaly web flags with a destructive ring + tooltip warning. */
export function ganttInverted(
  start: string | null,
  due: string | null,
): boolean {
  const s = utcDay(start);
  const d = utcDay(due);
  return s !== null && d !== null && s.getTime() > d.getTime();
}

/** Inclusive-day bar geometry on the axis, in pixels: `left`/`width` are
 *  already multiplied by `dayPx` so the renderer can place the View
 *  directly. */
export interface GanttBar {
  left: number;
  width: number;
  /** Single date (start XOR due) renders as a diamond marker. */
  isMarker: boolean;
  /** start > due anomaly — renderer adds the destructive ring/warning. */
  inverted: boolean;
}

/** Convenience wrapper an Issue row calls: parse the date strings, place
 *  the bar, carry the inverted flag for the renderer. */
export function ganttBarFor(
  issue: Pick<Issue, "start_date" | "due_date">,
  range: GanttRange,
  totalDays: number,
  dayPx: number,
): GanttBar | null {
  const bar = ganttBarGeometry({
    start: utcDay(issue.start_date),
    due: utcDay(issue.due_date),
    range,
    totalDays,
    dayPx,
  });
  if (!bar) return null;
  return {
    ...bar,
    inverted: ganttInverted(issue.start_date, issue.due_date),
  };
}

/**
 * The bar placement rule web ScheduledRow applies
 * (gantt-view.tsx:339-351): inverted ranges normalize to min..max,
 * clamped to the axis; a single date renders as a marker at least one
 * column wide; a bar entirely outside the axis draws nothing.
 */
export function ganttBarGeometry(params: {
  start: Date | null;
  due: Date | null;
  range: GanttRange;
  totalDays: number;
  dayPx: number;
}): GanttBar | null {
  const { start, due, range, totalDays, dayPx } = params;
  if (!start && !due) return null;
  const inverted =
    start !== null && due !== null && start.getTime() > due.getTime();
  const lo = start !== null && due !== null ? (inverted ? due : start) : start;
  const hi = start !== null && due !== null ? (inverted ? start : due) : due;
  const rangeStart = (lo ?? hi) as Date;
  const rangeEnd = (hi ?? lo) as Date;

  const s = Math.max(daysBetween(range.start, rangeStart), 0);
  const e = Math.min(daysBetween(range.start, rangeEnd) + 1, totalDays);
  if (e <= s) return null;
  if (start === null || due === null) {
    return {
      left: s * dayPx,
      width: Math.max(dayPx, 12),
      isMarker: true,
      inverted,
    };
  }
  return { left: s * dayPx, width: (e - s) * dayPx, isMarker: false, inverted };
}

/**
 * Axis range: today-centered with a zoom-dependent default pad, widened
 * to include every issue date (both ends — an inverted pair extends the
 * range through its later start too), then margin-padded. Mirrors web
 * computeRange (gantt-view.tsx:86-107).
 */
export function computeGanttRange(
  issues: Pick<Issue, "start_date" | "due_date">[],
  today: Date,
  zoom: GanttZoom,
): GanttRange {
  const defaultPad: Record<GanttZoom, number> = {
    day: 21,
    week: 60,
    month: 180,
  };
  let minTs = today.getTime() - defaultPad[zoom] * MS_PER_DAY;
  let maxTs = today.getTime() + defaultPad[zoom] * MS_PER_DAY;
  for (const i of issues) {
    const s = utcDay(i.start_date);
    const e = utcDay(i.due_date);
    if (s && s.getTime() < minTs) minTs = s.getTime();
    if (e && e.getTime() > maxTs) maxTs = e.getTime();
    if (s && s.getTime() > maxTs) maxTs = s.getTime();
    if (e && e.getTime() < minTs) minTs = e.getTime();
  }
  const pad = Math.max(2, Math.round(defaultPad[zoom] / 6));
  return {
    start: addDaysUTC(startOfDayUTC(new Date(minTs)), -pad),
    end: addDaysUTC(startOfDayUTC(new Date(maxTs)), pad + 1),
  };
}

/**
 * Gantt canvas membership — mirrors web `ganttCanvasRows`
 * (use-issue-surface-data.ts:44-49): a row needs a date to be placed,
 * and completed work hides unless asked for. The date check stays
 * defensive: the `scheduled=true` window should never deliver undated
 * rows, but a WS optimistic patch can.
 */
export function ganttCanvasRows(
  issues: Issue[],
  showCompleted: boolean,
): Issue[] {
  const dated = issues.filter((i) => i.start_date || i.due_date);
  if (showCompleted) return dated;
  return dated.filter((i) => i.status !== "done" && i.status !== "cancelled");
}
