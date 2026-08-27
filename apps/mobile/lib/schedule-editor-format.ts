/**
 * Preview formatting for the autopilot schedule editor — mirror of web
 * `formatInTimeZone` (packages/views/common/format-in-time-zone.ts).
 *
 * An autopilot's next run is printed on the schedule's clock, not the reader's:
 * a trigger that says "18:00 (America/Los_Angeles)" must not show its next run
 * as 09:00 to a reader in UTC+8. The wording — month name, 12-/24-hour dial —
 * is the reader's locale.
 */
export function formatInTimeZone(
  iso: string,
  timeZone: string | undefined,
  locale: string,
): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(at);
  } catch {
    return new Intl.DateTimeFormat(locale, options).format(at);
  }
}

export type CountdownDiff =
  | { kind: "less" }
  | { kind: "minutes"; minutes: number }
  | { kind: "hours"; hours: number; minutes: number }
  | { kind: "days"; days: number; hours: number; minutes: number };

/** The countdown to an instant, split the way the translated strings need it.
 *  null for an unreadable timestamp; `less` when within a minute (or already
 *  past). Mirrors web's useFormatCountdown unit breakdown. */
export function countdownDiff(iso: string, now: Date): CountdownDiff | null {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const diffMs = at - now.getTime();
  if (diffMs < 60_000) return { kind: "less" };
  const totalMin = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMin / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return { kind: "days", days, hours: hours % 24, minutes: totalMin % 60 };
  if (hours > 0) return { kind: "hours", hours, minutes: totalMin % 60 };
  return { kind: "minutes", minutes: totalMin };
}