/**
 * React Query `placeholderData` scope guard for the usage dashboard
 * (iteration 171).
 *
 * Web keeps the previous result mounted across a *range* change so the KPI
 * cards and charts transition in place instead of collapsing to a full-page
 * skeleton (packages/core/dashboard/queries.ts:53-65). Every other axis in the
 * key is deliberately excluded: carrying data across workspaces, projects or
 * timezones would briefly render one scope's numbers under another scope's
 * label, which is worse than a spinner.
 *
 * The mobile keys are laid out so that index 3 is always the range:
 *
 *   ["dashboard", <report>, wsId, days, projectId, tz]
 *
 * Web's guard hardcodes the same index for the same reason, and its test pins
 * it. Kept pure and React-free so the Node-only vitest lane can hold it.
 */

/** Index of the range (`days`) inside every dashboard query key. */
export const DASHBOARD_KEY_RANGE_INDEX = 3;

/**
 * True when `nextKey` differs from `previousKey` only by its range — i.e. the
 * previous data may be shown while the new range loads.
 *
 * A key that has never been seen (no previous key) is not the same scope, and
 * neither is a key of a different length: those are cache misses, not range
 * changes.
 */
export function isSameDashboardScope(
  previousKey: readonly unknown[] | undefined,
  nextKey: readonly unknown[],
): boolean {
  if (!previousKey || previousKey.length !== nextKey.length) return false;
  return previousKey.every(
    (part, index) =>
      index === DASHBOARD_KEY_RANGE_INDEX || Object.is(part, nextKey[index]),
  );
}
