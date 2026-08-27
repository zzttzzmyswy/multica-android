/**
 * Pure schedule model for the autopilot schedule editor — mirror of web
 * `packages/views/autopilots/components/schedule-editor/model.ts`. No React / RN
 * deps: the structured model both the editor and the cron mapping operate on.
 *
 * Hermes divergence: web uses Array.prototype.toSorted (ES2023); mobile must
 * copy-then-sort (see filter-issues.ts).
 */
export type TimePattern =
  | { kind: "at"; time: string } // "HH:MM"
  | {
      kind: "every";
      interval: number; // hours: 1-23, minutes: 1-59
      unit: "minutes" | "hours";
      // null = all day. For "hours" the window's from-minute is the firing
      // minute and `to` carries the same minute; for "minutes" the window is
      // hour-granular (from :00 to :59).
      window: { from: string; to: string } | null;
      // Firing minute for "hours" patterns ("every N hours at :M"), kept in
      // sync with window.from's minute when a window is set. Carried but
      // unused for "minutes" patterns (toCron ignores it there) so toggling
      // the unit back and forth does not discard the user's minute.
      minute: number;
    };

export type DayPattern =
  | { kind: "every" }
  | { kind: "weekly"; daysOfWeek: number[] } // 0=Sun … 6=Sat, non-empty, deduped, ascending
  | { kind: "monthly"; dayOfMonth: number }; // 1-31

export interface ScheduleConfig {
  time: TimePattern;
  days: DayPattern;
  timezone: string; // IANA
  // Non-null when the expression exceeds the structured model: the editor is
  // in advanced-only mode and this exact string round-trips verbatim.
  raw: string | null;
}

export function getDefaultScheduleConfig(timezone: string): ScheduleConfig {
  return {
    time: { kind: "at", time: "09:00" },
    days: { kind: "every" },
    timezone,
    raw: null,
  };
}

// Position is the cron day-of-week number, so this order is load-bearing: it
// indexes the locale's day names AND is what `daysOfWeek` holds.
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** The maximal runs of consecutive days in an ascending set. */
export function consecutiveRuns(days: number[]): Array<[number, number]> {
  const sorted = Array.from(new Set(days)).sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    runs.push([sorted[i]!, sorted[j]!]);
    i = j + 1;
  }
  return runs;
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function timeParts(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(":");
  return { hour: parseInt(h ?? "0", 10), minute: parseInt(m ?? "0", 10) };
}