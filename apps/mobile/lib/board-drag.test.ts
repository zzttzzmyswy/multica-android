import { describe, expect, it } from "vitest";
import {
  BOARD_PADDING,
  CARD_HEIGHT_FALLBACK,
  EDGE_PAN_MAX_STEP,
  EDGE_PAN_ZONE,
  LANE_GAP,
  dropIndexForY,
  edgePanStep,
  insertIdByPosition,
  laneIndexAtX,
  moveAnchors,
  moveWithinLanes,
  provisionalPosition,
  resolveDropTarget,
  rowFrames,
  storedLaneOrder,
  type LaneFrame,
} from "@/lib/board-drag";

/**
 * Board drag maths (iteration 176, G6).
 *
 * The board's drag has three pieces of arithmetic that fail silently: which
 * lane the finger is over, which slot inside that lane, and how fast the board
 * pans when the finger parks at an edge. All three are wrong in ways the screen
 * cannot show you — a card that lands one slot off reads as imprecise aim, and
 * an edge that pans the wrong way reads as the board fighting the finger. None
 * of them raises, so the arithmetic is pinned here.
 *
 * Every frame in these fixtures is in BOARD CONTENT coordinates (x) or LANE
 * CONTENT coordinates (y) — the same spaces the component measures into, so a
 * sign error in the component's translation shows up as a failure here rather
 * than as a card that jumps on release.
 */

/** Three 272pt lanes at the standard 10pt gap, 12pt padding — the real board. */
function lanes(...keys: string[]): LaneFrame[] {
  return keys.map((key, i) => ({
    key,
    x: BOARD_PADDING + i * (272 + LANE_GAP),
    width: 272,
  }));
}

describe("laneIndexAtX", () => {
  const three = lanes("a", "b", "c");

  it("finds the lane a point sits inside", () => {
    expect(laneIndexAtX(three, BOARD_PADDING + 5)).toBe(0);
    expect(laneIndexAtX(three, BOARD_PADDING + 272 + LANE_GAP + 5)).toBe(1);
    expect(laneIndexAtX(three, BOARD_PADDING + 2 * (272 + LANE_GAP) + 271)).toBe(2);
  });

  it("resolves a point in the gap to the NEARER lane", () => {
    // The gap is 10pt; its midpoint is 5pt in. A hard `contains` test would
    // return null here and the card would snap back to its origin lane every
    // time the finger crossed a gutter.
    const gapStart = BOARD_PADDING + 272;
    expect(laneIndexAtX(three, gapStart + 4)).toBe(0);
    expect(laneIndexAtX(three, gapStart + 6)).toBe(1);
  });

  it("clamps a point left of the first lane and right of the last", () => {
    expect(laneIndexAtX(three, -500)).toBe(0);
    expect(laneIndexAtX(three, 99_999)).toBe(2);
  });

  it("handles a narrower trailing lane", () => {
    // The hidden-columns lane is 0.85 of a full lane; hit-testing must read
    // the measured widths, not assume every lane is BOARD_COLUMN_WIDTH.
    const mixed: LaneFrame[] = [
      { key: "a", x: 12, width: 272 },
      { key: "hidden", x: 294, width: 231 },
    ];
    expect(laneIndexAtX(mixed, 294 + 231 - 1)).toBe(1);
    expect(laneIndexAtX(mixed, 294 + 231 + 400)).toBe(1);
  });

  it("returns null for a board with no lanes", () => {
    expect(laneIndexAtX([], 100)).toBeNull();
  });
});

describe("rowFrames", () => {
  it("stacks measured heights from the top", () => {
    const frames = rowFrames(["a", "b", "c"], { a: 60, b: 80, c: 40 });
    expect(frames).toEqual([
      { top: 0, height: 60 },
      { top: 60, height: 80 },
      { top: 140, height: 40 },
    ]);
  });

  it("falls back for a row that has not laid out", () => {
    const frames = rowFrames(["a", "b"], { a: 60 });
    expect(frames[1]).toEqual({
      top: 60,
      height: CARD_HEIGHT_FALLBACK,
    });
  });

  it("ignores a measured height for a row that is not in the lane", () => {
    // Heights are cached per issue id across the whole board, so a card that
    // moved lanes still carries its old measurement. Reading it for a row that
    // is no longer here would shift every slot below it.
    const frames = rowFrames(["a", "b"], { a: 60, ghost: 999 });
    expect(frames).toEqual([
      { top: 0, height: 60 },
      { top: 60, height: CARD_HEIGHT_FALLBACK },
    ]);
  });
});

describe("dropIndexForY", () => {
  const frames = rowFrames(["a", "b", "c"], { a: 60, b: 60, c: 60 });
  // midpoints: 30, 90, 150

  it("stays in the first slot above the first midpoint", () => {
    expect(dropIndexForY(frames, 0)).toBe(0);
    expect(dropIndexForY(frames, 29)).toBe(0);
  });

  it("moves to the next slot once the midpoint is crossed", () => {
    expect(dropIndexForY(frames, 31)).toBe(1);
    expect(dropIndexForY(frames, 89)).toBe(1);
    expect(dropIndexForY(frames, 91)).toBe(2);
  });

  it("clamps past the end to a trailing slot", () => {
    // The slot AFTER the last card is a real drop target — dragging to the
    // bottom of a lane must append, not land on the last card.
    expect(dropIndexForY(frames, 149)).toBe(2);
    expect(dropIndexForY(frames, 151)).toBe(3);
    expect(dropIndexForY(frames, 9999)).toBe(3);
  });

  it("clamps above the top to slot 0", () => {
    expect(dropIndexForY(frames, -9999)).toBe(0);
  });

  it("uses MEASURED heights, not a uniform card", () => {
    const mixed = rowFrames(["a", "b", "c"], { a: 40, b: 120, c: 40 });
    // b spans 40..160, midpoint 100.
    expect(dropIndexForY(mixed, 99)).toBe(1);
    expect(dropIndexForY(mixed, 101)).toBe(2);
  });

  it("returns slot 0 for an empty lane", () => {
    // An empty lane is a valid drop target (that is the whole point of
    // keeping empty status columns on the board).
    expect(dropIndexForY([], 500)).toBe(0);
  });
});

describe("edgePanStep", () => {
  const viewport = { viewportLeft: 0, viewportRight: 400 };

  it("does not pan while the finger is in the middle", () => {
    expect(edgePanStep({ x: 200, ...viewport })).toBe(0);
    expect(edgePanStep({ x: EDGE_PAN_ZONE, ...viewport })).toBe(0);
    expect(edgePanStep({ x: 400 - EDGE_PAN_ZONE, ...viewport })).toBe(0);
  });

  it("pans right-to-left near the LEFT edge", () => {
    // Finger at the left edge must pull earlier lanes into view, i.e. scrollX
    // decreases — the sign that makes "hold at the edge" walk backwards.
    expect(edgePanStep({ x: 0, ...viewport })).toBe(-EDGE_PAN_MAX_STEP);
    expect(edgePanStep({ x: EDGE_PAN_ZONE / 2, ...viewport })).toBe(
      -EDGE_PAN_MAX_STEP / 2,
    );
  });

  it("pans left-to-right near the RIGHT edge", () => {
    expect(edgePanStep({ x: 400, ...viewport })).toBe(EDGE_PAN_MAX_STEP);
    expect(edgePanStep({ x: 400 - EDGE_PAN_ZONE / 2, ...viewport })).toBe(
      EDGE_PAN_MAX_STEP / 2,
    );
  });

  it("scales with how deep into the zone the finger is", () => {
    const shallow = edgePanStep({ x: 400 - EDGE_PAN_ZONE + 4, ...viewport });
    const deep = edgePanStep({ x: 400 - 4, ...viewport });
    expect(Math.abs(deep)).toBeGreaterThan(Math.abs(shallow));
  });

  it("never exceeds the cap, even past the edge", () => {
    // The finger can leave the viewport (drag toward the bezel); an uncapped
    // ramp would make the board bolt.
    expect(edgePanStep({ x: 900, ...viewport })).toBe(EDGE_PAN_MAX_STEP);
    expect(edgePanStep({ x: -900, ...viewport })).toBe(-EDGE_PAN_MAX_STEP);
  });

  it("respects a viewport that does not start at 0", () => {
    expect(edgePanStep({ x: 120, viewportLeft: 120, viewportRight: 520 })).toBe(
      -EDGE_PAN_MAX_STEP,
    );
  });
});

describe("moveWithinLanes", () => {
  const board = { a: ["1", "2", "3"], b: ["4", "5"] };

  it("moves a card across lanes", () => {
    expect(moveWithinLanes(board, "a", "b", "1", 1)).toEqual({
      a: ["2", "3"],
      b: ["4", "1", "5"],
    });
  });

  it("reorders inside one lane", () => {
    expect(moveWithinLanes(board, "a", "a", "1", 2)).toEqual({
      a: ["2", "3", "1"],
      b: ["4", "5"],
    });
  });

  it("clamps the target index against the lane AFTER the card left it", () => {
    // Same-lane: the lane loses one element first, so index 3 in a 3-long
    // list is the append slot, not an out-of-range write. Clamping against
    // the pre-removal length would leave a hole.
    expect(moveWithinLanes(board, "a", "a", "1", 3)).toEqual({
      a: ["2", "3", "1"],
      b: ["4", "5"],
    });
  });

  it("appends into an empty lane", () => {
    expect(moveWithinLanes({ a: ["1"], b: [] }, "a", "b", "1", 0)).toEqual({
      a: [],
      b: ["1"],
    });
  });

  it("does not mutate the input", () => {
    const input = { a: ["1", "2"], b: ["3"] };
    moveWithinLanes(input, "a", "b", "1", 0);
    expect(input).toEqual({ a: ["1", "2"], b: ["3"] });
  });

  it("leaves the board alone for an unknown lane", () => {
    expect(moveWithinLanes(board, "a", "zzz", "1", 0)).toEqual(board);
  });

  it("is a no-op when the card lands exactly where it started", () => {
    expect(moveWithinLanes(board, "a", "a", "2", 1)).toEqual(board);
  });
});

describe("provisionalPosition", () => {
  const positions = { "1": 10, "2": 20, "3": 30, "4": 40 };

  it("takes the midpoint of its neighbours", () => {
    // "3" (position 30) dropped between "1" (10) and "2" (20).
    expect(provisionalPosition(["1", "3", "2"], 1, positions)).toBe(15);
  });

  it("steps below the first neighbour at the head", () => {
    // `ids` is the PREVIEW list — the dragged card is already at `index`, so
    // its neighbour is `ids[index + 1]`, never `ids[index]`.
    expect(provisionalPosition(["3", "1", "2"], 0, positions)).toBe(9);
  });

  it("steps above the last neighbour at the tail", () => {
    expect(provisionalPosition(["1", "2", "3"], 2, positions)).toBe(21);
  });

  it("keeps its own position as the only card in the lane", () => {
    // Nothing to be relative to — a fresh value would be invented from
    // nothing and could collide with another lane's card.
    expect(provisionalPosition(["2"], 0, positions)).toBe(20);
  });

  it("treats an unmeasured neighbour as position 0", () => {
    expect(provisionalPosition(["1", "ghost"], 1, positions)).toBe(11);
  });
});

describe("moveAnchors", () => {
  const ids = ["1", "2", "3"];

  it("names both neighbours in the middle", () => {
    expect(moveAnchors(ids, 1)).toEqual({ before_id: "1", after_id: "3" });
  });

  it("has no before at the head", () => {
    expect(moveAnchors(ids, 0)).toEqual({ before_id: null, after_id: "2" });
  });

  it("has no after at the tail", () => {
    expect(moveAnchors(ids, 2)).toEqual({ before_id: "2", after_id: null });
  });

  it("has neither in a lane holding only the dragged card", () => {
    expect(moveAnchors(["7"], 0)).toEqual({ before_id: null, after_id: null });
  });
});

describe("insertIdByPosition", () => {
  const positions = { a: 10, b: 20, c: 30 };

  it("inserts before the first card with a greater position", () => {
    expect(insertIdByPosition(["a", "b", "c"], "x", 15, positions)).toEqual([
      "a",
      "x",
      "b",
      "c",
    ]);
  });

  it("appends when nothing is greater", () => {
    expect(insertIdByPosition(["a", "b", "c"], "x", 99, positions)).toEqual([
      "a",
      "b",
      "c",
      "x",
    ]);
  });

  it("prepends when everything is greater", () => {
    expect(insertIdByPosition(["a", "b", "c"], "x", 1, positions)).toEqual([
      "x",
      "a",
      "b",
      "c",
    ]);
  });

  it("appends into an empty lane", () => {
    expect(insertIdByPosition([], "x", 42, positions)).toEqual(["x"]);
  });

  it("skips a card with no known position", () => {
    // A neighbour whose position has not loaded cannot decide the slot; the
    // card lands past it rather than at the head.
    expect(
      insertIdByPosition(["a", "ghost", "b"], "x", 15, positions),
    ).toEqual(["a", "ghost", "x", "b"]);
  });

  it("does not mutate the input", () => {
    const input = ["a", "b"];
    insertIdByPosition(input, "x", 15, positions);
    expect(input).toEqual(["a", "b"]);
  });
});

describe("storedLaneOrder", () => {
  it("reverses a descending position lane", () => {
    // Descending position renders the lane backwards; the move's anchors are
    // relative to the STORED order, so they have to be read off the flip.
    expect(storedLaneOrder(["c", "b", "a"], "position", "desc")).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("leaves an ascending position lane alone", () => {
    expect(storedLaneOrder(["a", "b", "c"], "position", "asc")).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("leaves a lane sorted by anything else alone", () => {
    // Under another sort the lane is not in position order at all, so
    // reversing it would be meaningless — those moves go through
    // `insertIdByPosition` instead.
    expect(storedLaneOrder(["c", "a", "b"], "title", "desc")).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("does not mutate the input", () => {
    const input = ["c", "b", "a"];
    storedLaneOrder(input, "position", "desc");
    expect(input).toEqual(["c", "b", "a"]);
  });
});

describe("resolveDropTarget", () => {
  /**
   * The board's own geometry: three 272pt lanes, board at window x=0 with no
   * horizontal offset. Card rows are 84pt, so the midpoints inside a lane sit
   * at 42 / 126 / 210.
   */
  const board = lanes("todo", "doing", "done");
  const heights = { i1: 84, i2: 84, i3: 84 };
  const todoIds = ["i1", "i2", "i3"];
  const laneIds = { todo: todoIds, doing: ["d1"], done: [] as string[] };
  const rows = {
    todo: rowFrames(todoIds, heights),
    doing: rowFrames(["d1"], heights),
    done: [] as ReturnType<typeof rowFrames>,
  };
  const listTop = { todo: 100, doing: 100, done: 100 };
  const scrollY = { todo: 0, doing: 0, done: 0 };

  const at = (
    fingerX: number,
    fingerY: number,
    over: Partial<{
      originLaneKey: string;
      originIndex: number;
      liftFingerY: number;
      boardScrollX: number;
      boardX: number;
    }> = {},
  ) =>
    resolveDropTarget({
      lanes: board,
      laneIds,
      rows,
      listTop,
      scrollY,
      cardHeights: heights,
      boardX: over.boardX ?? 0,
      boardScrollX: over.boardScrollX ?? 0,
      fingerX,
      fingerY,
      originLaneKey: over.originLaneKey ?? "todo",
      originIndex: over.originIndex ?? 1,
      liftFingerY: over.liftFingerY ?? 250,
    });

  /** A window x that lands squarely inside lane `i`. */
  const laneX = (i: number) => BOARD_PADDING + i * (272 + LANE_GAP) + 100;

  // i2 is the dragged card and spans lane-content 84..168, i.e. window
  // 184..268 with the lane list top at 100. 250 is therefore inside it, in its
  // LOWER half — past its own midpoint at 226.
  const GRAB_Y = 250;

  it("answers the ORIGIN slot for a lift that never moved", () => {
    expect(at(laneX(0), GRAB_Y)).toEqual({ laneKey: "todo", index: 1 });
  });

  it("answers the origin slot even with the finger in the card's lower half", () => {
    // The reported defect: an absolute hit test measures the finger against
    // the dragged card's OWN frame, so a grab below its midpoint reads as
    // "one slot down" before the user has moved at all — the lift then commits
    // a reorder and the long-press status sheet never opens.
    expect(GRAB_Y).toBeGreaterThan(184 + 84 / 2);
    expect(at(laneX(0), GRAB_Y, { liftFingerY: GRAB_Y })).toEqual({
      laneKey: "todo",
      index: 1,
    });
  });

  it("walks down one slot once the finger passes the next card's midpoint", () => {
    expect(at(laneX(0), GRAB_Y + 41)).toEqual({ laneKey: "todo", index: 1 });
    expect(at(laneX(0), GRAB_Y + 43)).toEqual({ laneKey: "todo", index: 2 });
  });

  it("walks up one slot once the finger passes the previous card's midpoint", () => {
    expect(at(laneX(0), GRAB_Y - 41)).toEqual({ laneKey: "todo", index: 1 });
    expect(at(laneX(0), GRAB_Y - 43)).toEqual({ laneKey: "todo", index: 0 });
  });

  it("stops at the ends of the lane", () => {
    expect(at(laneX(0), GRAB_Y + 5000)).toEqual({ laneKey: "todo", index: 2 });
    expect(at(laneX(0), GRAB_Y - 5000)).toEqual({ laneKey: "todo", index: 0 });
  });

  it("uses an ABSOLUTE hit test once the finger is over another lane", () => {
    // Finger over `doing` at lane-content y 40 — above d1's midpoint (42).
    expect(at(laneX(1), 140)).toEqual({ laneKey: "doing", index: 0 });
    // …and past it.
    expect(at(laneX(1), 145)).toEqual({ laneKey: "doing", index: 1 });
  });

  it("drops into the head of an empty lane", () => {
    expect(at(laneX(2), 700)).toEqual({ laneKey: "done", index: 0 });
  });

  it("resolves a finger in the gutter to the nearer lane", () => {
    const gutter = BOARD_PADDING + 272;
    expect(at(gutter + 4, GRAB_Y)).toEqual({ laneKey: "todo", index: 1 });
    expect(at(gutter + 6, GRAB_Y)).toEqual({ laneKey: "doing", index: 1 });
  });

  it("follows the board's scroll, so a parked finger changes lane as it pans", () => {
    // Same window x, board panned one lane+gap to the right: the content under
    // the finger is now the lane AFTER it. This is what makes edge auto-pan
    // walk the board while the finger holds still.
    expect(at(100, GRAB_Y)).toEqual({ laneKey: "todo", index: 1 });
    expect(at(100, GRAB_Y, { boardScrollX: 272 + LANE_GAP })).toEqual({
      laneKey: "doing",
      index: 1,
    });
  });

  it("subtracts the board's window origin before reading content space", () => {
    // A board inset from the left edge of the window: window x 100 is content
    // x 0, i.e. the padding strip of the first lane.
    expect(at(100 + 100, GRAB_Y, { boardX: 100 })).toEqual({
      laneKey: "todo",
      index: 1,
    });
  });

  it("returns null when the board has no measured lanes", () => {
    expect(
      resolveDropTarget({
        lanes: [],
        laneIds,
        rows,
        listTop,
        scrollY,
        cardHeights: heights,
        boardX: 0,
        boardScrollX: 0,
        fingerX: 100,
        fingerY: 500,
        originLaneKey: "todo",
        originIndex: 1,
        liftFingerY: 500,
      }),
    ).toBeNull();
  });
});
