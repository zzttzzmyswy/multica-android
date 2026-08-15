import { getCurrentLocale } from "./i18n";
import { useTranslation } from "./i18n/react";

/** Hook returning a localized relative-time formatter.
 *
 * Mirrors the algorithm in packages/views/inbox/components/inbox-list-item.tsx
 * `useTimeAgo` (Behavioral parity rule in apps/mobile/CLAUDE.md). Returns a
 * function (rather than a string) so call sites read `timeAgo(dateStr)`
 * unchanged. Localized via the app i18n store; en/zh keys live in
 * lib/i18n/locales/*.json under `time.*`.
 */
export function useTimeAgo() {
  const { t } = useTranslation();
  return (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t("time.justNow");
    if (minutes < 60) return t("time.minutesAgo", { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("time.hoursAgo", { count: hours });
    const days = Math.floor(hours / 24);
    if (days < 7) return t("time.daysAgo", { count: days });
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return t("time.weeksAgo", { count: weeks });
    // Older than ~5 weeks: show an absolute date in the active locale.
    return new Date(dateStr).toLocaleDateString(
      getCurrentLocale() === "zh" ? "zh-CN" : "en-US",
      { year: "numeric", month: "short", day: "numeric" },
    );
  };
}