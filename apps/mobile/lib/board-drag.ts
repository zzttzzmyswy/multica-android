/**
 * Drop-target maths for the board's drag-to-reorder (iteration 176, G6).
 *
 * Kept pure and outside the component for the same reason `pin-reorder.ts` is:
 * every one of these answers is wrong in a way nothing on screen makes
 * obvious. A card that lands one slot off reads as the user's aim being
 * imprecise; a lane hit-test that returns null in a gutter makes the card snap
 * home whenever the finger crosses one; an edge-pan with the wrong sign reads
 * as the board fighting the finger. None of them raises.
 *
 * Coordinate spaces, because mixing them up is the whole risk:
 *   - `LaneFrame.x` / `LaneFrame.width` are BOARD CONTENT coordinates — the
 *     lane's position inside the horizontal scroll content, so `laneIndexAtX`
 *     is independent of how far the board happens to be scrolled.
 *   - `RowFrame.top` is LANE CONTENT coordinates — the card's offset inside its
 *     own lane's vertical list, so `dropIndexForY` is independent of the lane's
 *     scroll position. The component converts the finger into each space once.
 */

import { dragTargetIndex } from "./pin-reorder";

/** Horizontal gap between lanes in the board's content container (pt). */
export const LANE_GAP = 10;

/** Left/right padding of the board's content container (pt). */
export const BOARD_PADDING = 12;

/**
 * Height assumed for a card that has not laid out yet. Board cards run ~76pt
 * (two-line title + optional label row + footer) plus the row's 8pt bottom
 * padding; the exact value only matters on the first frame of a drag, before
 * `onLayout` has reported the real ones.
 */
export const CARD_HEIGHT_FALLBACK = 84;

/** How close (pt) to a board edge the finger must be to auto-pan. */
export const EDGE_PAN_ZONE = 64;

/** Auto-pan speed (pt per animation frame) at the very edge of the zone. */
export const EDGE_PAN_MAX_STEP = 14;

/** A lane's horizontal extent, in board content coordinates. */
export type LaneFrame = { key: string; x: number; width: number };

/** A card row's vertical extent, in its lane's content coordinates. */
export type RowFrame = { top: number; height: number };

/**
 * The lane a point at board-content `x` is over.
 *
 * Distance-based rather than a `contains` test: the 10pt gutter between lanes
 * belongs to whichever lane is nearer. A hard containment test returns nothing
 * there, and the drag — which resolves its target every frame — would fall back
 * to the origin lane for the few frames the finger spent in the gutter, so a
 * cross-lane drag would flicker home and back on the way across.
 *
 * Out-of-range points clamp to the first / last lane for the same reason: the
 * finger leaves the board whenever it is dragged toward a bezel, and that must
 * read as "still on the nearest lane", not as "no target".
 */
export function laneIndexAtX(
  lanes: readonly LaneFrame[],
  x: number,
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i]!;
    const right = lane.x + lane.width;
    const distance = x < lane.x ? lane.x - x : x > right ? x - right : 0;
    // `<` keeps the LOWER index on a tie, so the boundary between two lanes
    // sits at the gutter's midpoint and does not depend on iteration order.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/**
 * Stack the lane's cards into measured frames, top-down.
 *
 * `measured` is keyed by issue id and shared across the whole board — a card
 * that has been dragged between lanes still carries the height it had where it
 * was measured. Only ids in `ids` are read, so a stale entry for a card that
 * has since left the lane cannot shift every slot below it.
 */
export function rowFrames(
  ids: readonly string[],
  measured: Record<string, number>,
  fallback: number = CARD_HEIGHT_FALLBACK,
): RowFrame[] {
  const frames: RowFrame[] = [];
  let top = 0;
  for (const id of ids) {
    const height = measured[id] ?? fallback;
    frames.push({ top, height });
    top += height;
  }
  return frames;
}

/**
 * The slot a point at lane-content `y` drops into.
 *
 * A card is only crossed once the finger passes its MIDPOINT — the same
 * hysteresis `pin-reorder.ts` uses, so a wobble around a boundary does not flip
 * the target back and forth. The returned index is a SLOT, not a card index:
 * `frames.length` is the append position at the bottom of the lane and 0 is the
 * head, which is why an empty lane answers 0 rather than nothing.
 */
export function dropIndexForY(frames: readonly RowFrame[], y: number): number {
  let index = 0;
  for (const frame of frames) {
    if (y < frame.top + frame.height / 2) break;
    index += 1;
  }
  return index;
}

/**
 * The (lane, slot) a finger at window `(fingerX, fingerY)` currently targets.
 *
 * Two different hit tests, because the two cases are not the same question:
 *
 *   - CROSS-LANE — the finger is over a lane the dragged card is NOT in, so
 *     that lane's frames describe a clean list and the slot is a plain absolute
 *     hit test against the measured midpoints.
 *   - SAME-LANE — the lane still contains the dragged card, because unmounting
 *     it (or moving it) would drop the Pressable that owns the gesture. An
 *     absolute hit test therefore measures the finger against the card's OWN
 *     frame as well, and a finger resting in the LOWER HALF of the card it is
 *     holding is already past that card's midpoint: a lift the user never moved
 *     would read as "one slot down" and commit a reorder — which is also what
 *     kept the long-press status sheet from ever opening, since `moved` is
 *     sticky. So the same-lane slot is INCREMENTAL: the finger's displacement
 *     since the lift, walked against the neighbouring midpoints
 *     (`pin-reorder.dragTargetIndex`, already proven by the pinned list). Zero
 *     displacement answers the origin slot by construction.
 *
 * `lanes`, `laneIds`, `rows`, `listTop`, `scrollY` and `board` are the geometry
 * frozen at lift; `boardScrollX` is the board's live horizontal offset, which
 * moves under a stationary finger during edge auto-pan and is the whole point
 * of panning in CONTENT space.
 */
export function resolveDropTarget({
  lanes,
  laneIds,
  rows,
  listTop,
  scrollY,
  cardHeights,
  boardX,
  boardScrollX,
  fingerX,
  fingerY,
  originLaneKey,
  originIndex,
  liftFingerY,
}: {
  lanes: readonly LaneFrame[];
  laneIds: Record<string, readonly string[]>;
  rows: Record<string, readonly RowFrame[]>;
  listTop: Record<string, number>;
  scrollY: Record<string, number>;
  cardHeights: Record<string, number>;
  boardX: number;
  boardScrollX: number;
  fingerX: number;
  fingerY: number;
  originLaneKey: string;
  originIndex: number;
  /** Window Y of the finger when the card was lifted. */
  liftFingerY: number;
}): { laneKey: string; index: number } | null {
  const laneIndex = laneIndexAtX(lanes, fingerX - boardX + boardScrollX);
  if (laneIndex === null) return null;
  const lane = lanes[laneIndex]!;
  if (lane.key === originLaneKey) {
    return {
      laneKey: lane.key,
      index: dragTargetIndex({
        ids: laneIds[lane.key] ?? [],
        heights: cardHeights,
        startIndex: originIndex,
        delta: fingerY - liftFingerY,
      }),
    };
  }
  const contentY =
    fingerY - (listTop[lane.key] ?? 0) + (scrollY[lane.key] ?? 0);
  return {
    laneKey: lane.key,
    index: dropIndexForY(rows[lane.key] ?? [], contentY),
  };
}

/**
 * How far to scroll the board this frame, given the finger's absolute `x`.
 *
 * Negative scrolls toward earlier lanes (finger parked at the LEFT edge),
 * positive toward later ones. The ramp is linear in how deep into the zone the
 * finger is, so a nudge pans slowly and a press against the bezel pans at full
 * speed; it is capped at the edge because the finger does leave the viewport
 * when dragged toward a bezel, and an uncapped ramp would make the board bolt.
 */
export function edgePanStep({
  x,
  viewportLeft,
  viewportRight,
  zone = EDGE_PAN_ZONE,
  maxStep = EDGE_PAN_MAX_STEP,
}: {
  x: number;
  viewportLeft: number;
  viewportRight: number;
  zone?: number;
  maxStep?: number;
}): number {
  const clamp = (value: number) => Math.min(Math.max(value, 0), zone);
  const leftDepth = clamp(viewportLeft + zone - x);
  if (leftDepth > 0) return -(leftDepth / zone) * maxStep;
  const rightDepth = clamp(x - (viewportRight - zone));
  if (rightDepth > 0) return (rightDepth / zone) * maxStep;
  return 0;
}

/**
 * Move `itemId` from `fromLane` to slot `toIndex` of `toLane`, returning a new
 * lane map. Unknown lanes are returned untouched, as is a move that lands the
 * card exactly where it already was.
 *
 * The target index is clamped against the destination AFTER the card has left
 * its origin lane — for a same-lane reorder those are the same array, so
 * clamping first would leave a hole at the tail and make "drag to the bottom"
 * land one slot short.
 */
export function moveWithinLanes<T>(
  lanes: Record<string, T[]>,
  fromLane: string,
  toLane: string,
  itemId: T,
  toIndex: number,
): Record<string, T[]> {
  if (!(fromLane in lanes) || !(toLane in lanes)) return lanes;
  const withoutItem = (list: T[]) => list.filter((entry) => entry !== itemId);
  const origin = withoutItem(lanes[fromLane]!);
  const destination = fromLane === toLane ? origin : withoutItem(lanes[toLane]!);
  const at = Math.min(Math.max(toIndex, 0), destination.length);
  const next = [...destination.slice(0, at), itemId, ...destination.slice(at)];
  return { ...lanes, [fromLane]: origin, [toLane]: next };
}

/**
 * A position for the optimistically-moved card, derived from the neighbours it
 * now sits between. Mirrors web's `computePosition` in
 * `packages/views/issues/utils/drag-utils.ts` so the card's provisional slot
 * matches what the server derives from the anchors — otherwise the card would
 * land in one place and jump when the settle reconcile rebuilds from the cache.
 *
 * `ids` is the PREVIEW lane (the card already inserted at `index`). A lane
 * holding only the dragged card keeps the card's own position: there is no
 * neighbour to be relative to, and inventing one could collide with a card in
 * another lane.
 */
export function provisionalPosition(
  ids: readonly string[],
  index: number,
  positions: Record<string, number | undefined>,
): number {
  const at = (i: number) => positions[ids[i]!] ?? 0;
  if (ids.length === 0) return 0;
  if (ids.length === 1) return at(0);
  if (index <= 0) return at(1) - 1;
  if (index >= ids.length - 1) return at(ids.length - 2) + 1;
  return (at(index - 1) + at(index + 1)) / 2;
}

/**
 * The workspace-scoped neighbours the server derives the canonical position
 * from (`MoveIssueRequest.before_id` / `after_id`). Same contract as web's
 * `getMoveAnchors`: null means "no neighbour on that side", which is how the
 * server tells head/tail from "unchanged".
 */
export function moveAnchors(
  ids: readonly string[],
  index: number,
): { before_id: string | null; after_id: string | null } {
  return {
    before_id: index > 0 ? ids[index - 1]! : null,
    after_id: index >= 0 && index < ids.length - 1 ? ids[index + 1]! : null,
  };
}

/**
 * Insert `id` into `ids` at the slot its EXISTING position belongs in, reading
 * each id's position from `positions`. Mirrors web's `insertIdByPosition`
 * (`packages/views/issues/utils/drag-utils.ts:115-127`).
 *
 * Only used when the board is sorted by something other than `position`. There
 * the lane is not in position order, so the slot the finger picked says nothing
 * about where the card belongs in the manual order — carrying the card's
 * current position across and letting it fall where that position belongs is
 * what keeps the manual order intact for when the user switches back to it.
 */
export function insertIdByPosition(
  ids: readonly string[],
  id: string,
  position: number,
  positions: Record<string, number | undefined>,
): string[] {
  const at = ids.findIndex((existing) => {
    const value = positions[existing];
    return value !== undefined && value > position;
  });
  if (at === -1) return [...ids, id];
  return [...ids.slice(0, at), id, ...ids.slice(at)];
}

/**
 * The lane in the order the SERVER stores it, given the order the lane is
 * rendered in.
 *
 * Descending `position` renders the lane in exactly the reverse of the
 * server's ascending order, so a drop slot measured against the screen names
 * the opposite place. The move's anchors and its provisional position are both
 * relative to the stored order, so the lane has to be flipped back before
 * either is derived — otherwise a drag downward under `position desc` would
 * move the card up. Any other sort leaves the order alone here: the anchors
 * for those come from `insertIdByPosition` instead.
 */
export function storedLaneOrder(
  ids: readonly string[],
  sortBy: string,
  sortDirection: "asc" | "desc",
): string[] {
  if (sortBy !== "position" || sortDirection !== "desc") return [...ids];
  return [...ids].reverse();
}
