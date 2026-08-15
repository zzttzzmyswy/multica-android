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
}

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