/**
 * Label decisions for the run timeline, kept pure so the two rules that are
 * easy to get subtly wrong live in the Node test lane:
 *
 *  - **day grouping labels** resolve against the reader's LOCAL calendar, so a
 *    run at 23:30 local is "Yesterday" when they wake up, not "Today" because
 *    UTC hasn't rolled over yet;
 *  - **the spend strip's axis ends** read clock times while the issue is
 *    today's, day names once it spans more, and "Now" while a run is still
 *    going (web `execution_log.sparkline_now`).
 *
 * Both mirror web's inline logic in
 * `packages/views/issues/components/issue-runs-dialog.tsx` (`dayLabel`) and
 * `.../execution-log-section.tsx` (`startLabel` / `endLabel`).
 */

/** Which phrase a day group's header takes. */
export type DayLabelKind = "today" | "yesterday" | "date";

/** Local midnight of the day `ms` falls on. */
export function localDayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Whether a day group reads "Today", "Yesterday", or a date. `nowMs` is passed
 * in rather than read, so the caller decides when the clock is sampled — the
 * runs sheet re-reads it when the task list changes, not on a ticker.
 */
export function dayLabelKind(dayMs: number, nowMs: number): DayLabelKind {
  const today = localDayStart(nowMs);
  if (dayMs === today) return "today";
  // Calendar subtraction, not `today - 86_400_000`: the day before a DST
  // spring-forward is 23 hours long, and the millisecond form would call it
  // two days back.
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayMs === yesterday.getTime()) return "yesterday";
  return "date";
}

/** Which form each end of the spend strip's axis takes. */
export type AxisEndKind = "clock" | "day" | "today" | "now";

export interface AxisEndKinds {
  start: "clock" | "day";
  end: AxisEndKind;
}

/**
 * The strip's two axis ends. `extent` is the stretch that holds runs; a run
 * still going makes the right end "Now" whatever the dates say, because the
 * axis really does end at the present moment.
 */
export function axisEndKinds(
  extent: [number, number],
  activeCount: number,
  nowMs: number,
): AxisEndKinds {
  const [e0, e1] = extent;
  const today = localDayStart(nowMs);
  const allToday = localDayStart(e0) === today;
  if (activeCount > 0) return { start: allToday ? "clock" : "day", end: "now" };
  if (allToday) return { start: "clock", end: "clock" };
  if (localDayStart(e1) === today) return { start: "day", end: "today" };
  return { start: "day", end: "day" };
}

/**
 * Whether the axis spans more than a day and a half — the same threshold
 * `timeTicks` uses to switch from hourly to daily ticks, so the pointer's time
 * tag and the axis labels always agree about which grain they are reading.
 */
export const MULTI_DAY_MS = 36 * 60 * 60 * 1000;

export function isMultiDay(extent: [number, number]): boolean {
  return extent[1] - extent[0] > MULTI_DAY_MS;
}
