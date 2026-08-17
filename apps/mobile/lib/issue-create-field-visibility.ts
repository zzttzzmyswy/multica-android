/**
 * Pure field-visibility planning for a create-issue toolbar. Extracted from
 * `CreateFormAttributeRow` so the mode-driven rule ("show configured fields,
 * plus any field currently holding a value; hide-but-keep-reachable the
 * rest") is unit-testable without a React Native render.
 *
 * Mirrors web's contract in `create-issue.tsx` / `quick-create-issue.tsx`:
 * `visibleFields.includes(f) || holdsValue(f) || just-opened`. The mobile
 * modal opens hidden fields from the ⋯ overflow, so "just opened" is a
 * render-time concern inside the component — this planner covers the
 * configured + value-held halves.
 */
export function visibleFields<F extends string>(
  pool: readonly F[],
  configured: readonly F[],
  holdsValue: (f: F) => boolean,
): F[] {
  return pool.filter((f) => configured.includes(f) || holdsValue(f));
}

/** Fields hidden AND valueless — the ⋯ overflow menu lists these. A hidden
 *  field that holds a value leaves the overflow (and re-renders inline). */
export function overflowFields<F extends string>(
  pool: readonly F[],
  configured: readonly F[],
  holdsValue: (f: F) => boolean,
): F[] {
  return pool.filter((f) => !configured.includes(f) && !holdsValue(f));
}