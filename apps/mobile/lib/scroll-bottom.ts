/**
 * Pure scroll-position helpers shared by the chat message list and the
 * issue timeline's "jump to bottom" floating button.
 *
 * Kept framework-agnostic so the threshold math is unit-testable in the
 * Node vitest lane (no RN / FlashList native shims).
 */

export interface ScrollMetrics {
  /** `contentOffset.y` from the scroll event. */
  contentOffsetY: number;
  /** `contentSize.height` — total scrollable content height. */
  contentHeight: number;
  /** `layoutMeasurement.height` — the visible viewport height. */
  viewportHeight: number;
  /** Pixel band at the bottom edge that counts as "already at bottom". */
  slackPx: number;
  /** Pixel band at the top edge that counts as "already at top". Defaults
   *  to `AT_TOP_SLACK_PX` when omitted. */
  topSlackPx?: number;
}

/**
 * Shared bottom-edge slack (px) used by both the chat message list and the
 * issue timeline: within this band the user counts as "at bottom" and the
 * jump-to-bottom FAB hides. Single source of truth so the two screens feel
 * consistent.
 */
export const AT_BOTTOM_SLACK_PX = 80;

/** Shared top-edge slack (px), symmetric to `AT_BOTTOM_SLACK_PX`: within
 *  this band the user counts as "at top" and the jump-to-top button hides. */
export const AT_TOP_SLACK_PX = 80;

/** Distance in px between the viewport's bottom edge and the content end
 *  (>= 0 means the viewport is at or past the very bottom). */
export function distanceFromBottom(m: ScrollMetrics): number {
  return m.contentHeight - (m.contentOffsetY + m.viewportHeight);
}

/** True when the viewport sits within `slackPx` of the list's bottom edge —
 *  i.e. the user is effectively "caught up" and a jump-to-bottom affordance
 *  should be hidden. */
export function isNearBottom(m: ScrollMetrics): boolean {
  return distanceFromBottom(m) <= m.slackPx;
}

/** True when the viewport sits within the top slack band — i.e. the user is
 *  effectively "at the top" and a jump-to-top affordance should be hidden.
 *  Negative offsets (pull-to-refresh overscroll) still count as at-top. */
export function isNearTop(m: ScrollMetrics): boolean {
  return m.contentOffsetY <= (m.topSlackPx ?? AT_TOP_SLACK_PX);
}

/** The FAB's desired visibility for a scroll sample: shown when scrolled up
 *  away from the bottom, hidden when at/near it. */
export function wantJumpFab(m: ScrollMetrics): boolean {
  return !isNearBottom(m);
}

/** The jump-to-top button's desired visibility for a scroll sample: shown
 *  only in the middle band (neither at the top, where it is pointless, nor
 *  at the bottom, where it would break the clean "caught up" state). */
export function wantJumpTopFab(m: ScrollMetrics): boolean {
  return !isNearTop(m) && !isNearBottom(m);
}

/**
 * Next FAB visibility for a high-frequency scroll stream, deduplicated: when
 * the sample's desired visibility equals the currently-rendered one, return
 * the current value unchanged (the callers skip their `setState` in that
 * case to avoid a re-render every frame). Returns the new value only when it
 * actually changes.
 */
export function nextFabVisibility(
  current: boolean,
  sample: ScrollMetrics,
): boolean {
  const want = wantJumpFab(sample);
  return want === current ? current : want;
}

/**
 * `nextFabVisibility` twin for the jump-to-top button. Same dedup contract —
 * returns the new value only when the sample actually flips the desired
 * visibility, so a churned `onScroll` handler doesn't re-render per frame.
 */
export function nextJumpTopFabVisibility(
  current: boolean,
  sample: ScrollMetrics,
): boolean {
  const want = wantJumpTopFab(sample);
  return want === current ? current : want;
}
