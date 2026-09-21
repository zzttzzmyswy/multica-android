/**
 * Drop-target maths for the pinned list's drag-to-reorder.
 *
 * Kept pure and outside the component because the arithmetic is the part that
 * can be wrong in a way nothing on screen makes obvious: a drop that lands one
 * slot off looks like the user's own aim being imprecise, not like a bug. The
 * rendered list mixes issue rows with taller project rows, so the mapping from
 * a vertical finger delta to a list index has to use the MEASURED heights —
 * dividing by an assumed uniform row height puts the drop in the wrong slot
 * the moment two different row types appear together.
 */

/** Height assumed for a row that has not laid out yet (first frame only). */
export const ROW_HEIGHT_FALLBACK = 52;

/**
 * Reorder `items` by moving the element at `from` to `to`.
 *
 * `from` is always the ORIGINAL index captured before the drag started, never
 * the element's current position — a drag is a repeated "move the dragged row
 * here" and re-reading its index would splice out whatever happens to sit at
 * the old slot now, which is a different row.
 */
export function reorderByMove<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...items];
  next.splice(Math.min(Math.max(to, 0), next.length), 0, moved);
  return next;
}

/**
 * The index a drag that started at `startIndex` and has moved `delta` pixels
 * (positive = down) currently targets.
 *
 * A row is only crossed once the finger passes its MIDPOINT, so a small wobble
 * around a boundary does not flip the target back and forth — the same
 * hysteresis a native list gives you. `heights` is the measured height per
 * row id; anything missing falls back to `ROW_HEIGHT_FALLBACK`.
 */
export function dragTargetIndex({
  ids,
  heights,
  startIndex,
  delta,
}: {
  ids: readonly string[];
  heights: Record<string, number>;
  startIndex: number;
  delta: number;
}): number {
  const heightOf = (id: string | undefined) =>
    (id !== undefined ? heights[id] : undefined) ?? ROW_HEIGHT_FALLBACK;

  let cursor = startIndex;
  let remaining = delta;

  while (remaining > 0 && cursor < ids.length - 1) {
    const nextHeight = heightOf(ids[cursor + 1]);
    if (remaining < nextHeight / 2) break;
    remaining -= nextHeight;
    cursor += 1;
  }
  while (remaining < 0 && cursor > 0) {
    const thisHeight = heightOf(ids[cursor]);
    if (-remaining < thisHeight / 2) break;
    remaining += thisHeight;
    cursor -= 1;
  }

  return cursor;
}
