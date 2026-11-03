/**
 * Presentation helpers for the cloud runtime dialog, mirroring web's
 * `packages/views/runtimes/components/cloud-runtime-dialog.tsx`.
 *
 * Kept out of the component so the rendering can be asserted without an RN
 * renderer (see `vitest.config.ts`: this lane is pure helpers only).
 */
import { getIntlLocale } from "./i18n";

const NODE_TIMESTAMP: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

/**
 * Format a node's `created_at` in the ACTIVE app locale.
 *
 * `locale` must never be left undefined: Intl then falls back to the DEVICE
 * locale, so a Chinese UI on an English phone renders "Nov 2, 09:30 AM"
 * between two Chinese labels. Same rule as `lib/format-date.ts` — that file
 * documents it, `lib/autopilot-format.ts` complies, and this one used to be
 * the exception (iteration 284, MYS-2580).
 *
 * Components should pass the tag from `useIntlLocale()` so switching the app
 * language re-renders them; the default is correct only for a caller that
 * already subscribes to the locale store.
 *
 * Returns null for an unparseable timestamp — the dialog renders the row
 * without a date rather than showing "Invalid Date".
 */
export function formatCloudRuntimeNodeCreatedAt(
  value: string,
  locale: string = getIntlLocale(),
): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, NODE_TIMESTAMP).format(date);
}
