import { describe, expect, it } from "vitest";
import {
  ROW_HEIGHT_FALLBACK,
  dragTargetIndex,
  reorderByMove,
} from "@/lib/pin-reorder";

/**
 * Pinned-list drag maths (iteration 173, P2).
 *
 * Both halves of this are easy to get subtly wrong in a way the UI cannot show
 * you: a drop that lands one slot off reads as the user's aim being
 * imprecise, and a list that came back in the wrong order looks like the drag
 * "didn't take". Neither leaves a stack trace, so the arithmetic is pinned
 * here.
 */
describe("reorderByMove", () => {
  const items = ["a", "b", "c", "d"];

  it("moves an item down", () => {
    expect(reorderByMove(items, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item up", () => {
    expect(reorderByMove(items, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("is a no-op when from === to", () => {
    expect(reorderByMove(items, 2, 2)).toEqual(items);
  });

  it("does not mutate the input", () => {
    const input = [...items];
    reorderByMove(input, 0, 3);
    expect(input).toEqual(items);
  });

  it("clamps a target past the end", () => {
    expect(reorderByMove(items, 0, 99)).toEqual(["b", "c", "d", "a"]);
  });

  it("returns the list unchanged for an out-of-range source", () => {
    expect(reorderByMove(items, 9, 0)).toEqual(items);
  });

  it("rebuilds the same order when replayed from the ORIGINAL index", () => {
    // How the drag is actually driven: every move recomputes from the index
    // the row had when the gesture started, not from where it sits now.
    // Replaying against the live list instead would splice out a different
    // row — that bug is what this case exists to catch.
    let order = [...items];
    for (const target of [1, 2, 3]) {
      order = reorderByMove(items, 0, target);
    }
    expect(order).toEqual(["b", "c", "d", "a"]);
  });
});

describe("dragTargetIndex", () => {
  const ids = ["a", "b", "c", "d"];
  const uniform = Object.fromEntries(
    ids.map((id) => [id, 50]),
  ) as Record<string, number>;

  it("stays put below the next row's midpoint", () => {
    expect(dragTargetIndex({ ids, heights: uniform, startIndex: 0, delta: 20 })).toBe(0);
  });

  it("crosses into the next row past its midpoint", () => {
    expect(dragTargetIndex({ ids, heights: uniform, startIndex: 0, delta: 26 })).toBe(1);
  });

  it("walks past several rows when the drag is long", () => {
    expect(dragTargetIndex({ ids, heights: uniform, startIndex: 0, delta: 130 })).toBe(3);
  });

  it("walks upward from a lower row", () => {
    expect(dragTargetIndex({ ids, heights: uniform, startIndex: 3, delta: -130 })).toBe(0);
  });

  it("clamps at both ends", () => {
    expect(dragTargetIndex({ ids, heights: uniform, startIndex: 0, delta: -500 })).toBe(0);
    expect(dragTargetIndex({ ids, heights: uniform, startIndex: 3, delta: 500 })).toBe(3);
  });

  it("uses MEASURED heights, not a uniform row", () => {
    // a=40 (issue row), b=90 (project row). Crossing into b needs half of
    // b's own height (45), not half of the row being dragged (20) — and not
    // the 26 a uniform 50pt row would have accepted.
    const mixed = { a: 40, b: 90, c: 40, d: 40 };
    expect(dragTargetIndex({ ids, heights: mixed, startIndex: 0, delta: 44 })).toBe(0);
    expect(dragTargetIndex({ ids, heights: mixed, startIndex: 0, delta: 46 })).toBe(1);
    // Past b entirely (45 + 90 = 135 to reach c's midpoint at 135 + 20).
    expect(dragTargetIndex({ ids, heights: mixed, startIndex: 0, delta: 150 })).toBe(2);
  });

  it("falls back to the default height for a row that has not laid out", () => {
    expect(
      dragTargetIndex({ ids, heights: {}, startIndex: 0, delta: ROW_HEIGHT_FALLBACK }),
    ).toBe(1);
  });
});
