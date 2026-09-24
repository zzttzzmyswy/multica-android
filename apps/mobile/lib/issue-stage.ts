/**
 * Pure stage helpers for sub-issues, mirroring web
 * `packages/views/issues/components/pickers/stage-picker.tsx:14-27`.
 *
 * A "stage" orders a parent's children relative to each other, so it is
 * meaningless without a parent — the attribute row only offers it on a
 * sub-issue. The option list is derived rather than fixed: it must always
 * cover the current stage, the highest stage any SIBLING already uses (so an
 * existing higher stage stays selectable), and one beyond that so a new stage
 * can be created. Floored at three so a fresh family still has room to grow
 * without inventing stages one at a time.
 *
 * Pure and separate from the sheet so the boundaries are testable — the
 * off-by-one here is invisible in the UI (a missing "Stage 5" row just looks
 * like the list ended).
 */

/** Highest stage among a parent's children; 0 when none are staged. */
export function maxSiblingStage(
  children: readonly { stage: number | null | undefined }[],
): number {
  return children.reduce(
    (max, child) =>
      child.stage != null && child.stage > max ? child.stage : max,
    0,
  );
}

/** Selectable stage numbers, ascending, always including the current one. */
export function stageOptions(stage: number | null, maxStage = 0): number[] {
  const top = Math.max(stage ?? 0, maxStage, 2) + 1;
  return Array.from({ length: top }, (_, i) => i + 1);
}
