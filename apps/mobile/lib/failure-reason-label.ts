/**
 * Localized failure-reason helper backed by the app i18n store.
 *
 * Mirror of `packages/views/agents/components/tabs/task-failure.ts:REASON_LABEL`
 * in behavior, but the human copy is mobile-owned (apps/mobile CLAUDE.md
 * sharing rule forbids importing from packages/views).
 *
 * `failure_reason` is an open string that grows as classifier rules land, and
 * an installed build will meet reasons it predates. When the current locale
 * has no entry for a reason, it degrades to a plain local "failed" label
 * rather than leaking the raw wire value at the user.
 */
export function failureReasonLabel(
  reason: string | null | undefined,
  t: (id: string) => string,
): string {
  if (!reason) return t("failureReason.failed");
  const localized = t(`failureReason.${reason}`);
  // translate() returns the raw id when the key is unknown.
  if (localized !== `failureReason.${reason}`) return localized;
  return t("failureReason.failed");
}