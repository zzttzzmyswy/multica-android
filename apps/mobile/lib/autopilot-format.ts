/**
 * Presentation helpers for the autopilot screens. Mirrors web's
 * `formatInTimeZone` rendering in packages/views/autopilots (list next-run
 * cell, run rows) — absolute local-time, not relative, so "next run" /
 * "triggered at" read precisely. Unknown / unparseable timestamps fall back
 * to the raw string rather than crashing (API Response Compatibility).
 */
import { getCurrentLocale } from "./i18n";

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(getCurrentLocale() === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Calendar-day short date for rows where time-of-day is noise. */
export function formatDateOnlyShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(
    getCurrentLocale() === "zh" ? "zh-CN" : "en-US",
    { month: "short", day: "numeric" },
  );
}