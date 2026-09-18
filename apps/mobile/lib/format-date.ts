import { formatDateOnly } from "@multica/core/issues/date";
import { getIntlLocale } from "./i18n";

/** Short calendar-day format used by issue chips, rows and table cells. */
export const ISSUE_DATE_SHORT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
};

/**
 * Format an issue's calendar day ("YYYY-MM-DD") in the ACTIVE app locale.
 *
 * The app language is a separate setting from the device language, so `locale`
 * must never be left undefined: Intl then falls back to the device locale and
 * a Chinese UI on an English phone renders "Sep 24".
 *
 * Components should pass the `locale` from `useTranslation()` (or
 * `useAppLocale()`) so a language switch re-renders them. Hook-less helpers can
 * omit it and read the store — correct as long as their caller subscribes.
 */
export function formatIssueDate(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = ISSUE_DATE_SHORT,
  locale: string = getIntlLocale(),
): string {
  return formatDateOnly(value, options, locale);
}
