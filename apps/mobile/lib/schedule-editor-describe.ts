/**
 * Plain-language readback of a structured schedule — mirror of web
 * `packages/views/autopilots/components/schedule-editor/describe.ts`, adapted to
 * the mobile flat-key `t(id, params)` translator. Returns null in advanced-only
 * mode, where there is no structured model to describe.
 */
import type { ScheduleConfig } from "./schedule-editor-model";
import { consecutiveRuns, DAY_KEYS, pad2 } from "./schedule-editor-model";

export type DescribeT = (id: string, params?: Record<string, string | number>) => string;

const K = "autopilots.schedule_editor.describe";

function dayNameKey(d: number): string {
  return `${K}.days_long.${DAY_KEYS[d]}`;
}

/** Collapse runs of 3+ consecutive days into a range ("Mon–Fri"), list the rest. */
function formatDayList(t: DescribeT, days: number[]): string {
  const name = (d: number) => t(dayNameKey(d));
  const parts: string[] = [];
  for (const [lo, hi] of consecutiveRuns(days)) {
    if (hi - lo >= 2) {
      parts.push(t(`${K}.days_range`, { from: name(lo), to: name(hi) }));
    } else {
      for (let d = lo; d <= hi; d++) parts.push(name(d));
    }
  }
  return parts.join(t(`${K}.days_join`));
}

export function describeSchedule(t: DescribeT, config: ScheduleConfig): string | null {
  if (config.raw !== null) return null;

  const clauses: string[] = [];
  const { time } = config;
  if (time.kind === "at") {
    clauses.push(t(`${K}.time_at`, { time: time.time }));
  } else if (time.unit === "hours") {
    if (time.window === null) {
      const minute = pad2(time.minute);
      clauses.push(
        time.interval === 1
          ? t(`${K}.time_every_hour`, { minute })
          : t(`${K}.time_every_hours`, { interval: time.interval, minute }),
      );
    } else {
      clauses.push(
        time.interval === 1
          ? t(`${K}.time_every_hour_window`)
          : t(`${K}.time_every_hours_window`, { interval: time.interval }),
      );
      clauses.push(
        t(`${K}.window`, { from: time.window.from, to: time.window.to }),
      );
    }
  } else {
    clauses.push(
      time.interval === 1
        ? t(`${K}.time_every_minute`)
        : t(`${K}.time_every_minutes`, { interval: time.interval }),
    );
    if (time.window !== null) {
      clauses.push(t(`${K}.window`, { from: time.window.from, to: time.window.to }));
    }
  }

  switch (config.days.kind) {
    case "every":
      clauses.push(t(`${K}.days_every`));
      break;
    case "weekly":
      clauses.push(formatDayList(t, config.days.daysOfWeek));
      break;
    case "monthly":
      clauses.push(t(`${K}.days_monthly`, { day: config.days.dayOfMonth }));
      break;
  }

  return clauses.join(" · ");
}