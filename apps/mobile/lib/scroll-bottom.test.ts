/**
 * Unit tests for the scroll-position helper behind the chat / issue
 * "jump to bottom" floating button.
 *
 * The FAB is shown when the user scrolls away from the list bottom and
 * hidden when they are effectively caught up. `isNearBottom` is the single
 * source of truth for that on/off decision across both lists.
 */
import { describe, expect, it } from "vitest";
import {
  distanceFromBottom,
  isNearBottom,
  type ScrollMetrics,
} from "./scroll-bottom";

function metrics(partial: Partial<ScrollMetrics>): ScrollMetrics {
  // A list whose content is 1000px tall, viewport 400px tall, slack 80px.
  return {
    contentOffsetY: 600, // exactly at the bottom: 1000 - (600+400) = 0
    contentHeight: 1000,
    viewportHeight: 400,
    slackPx: 80,
    ...partial,
  };
}

describe("distanceFromBottom", () => {
  it("is 0 at the very bottom", () => {
    expect(distanceFromBottom(metrics({}))).toBe(0);
  });

  it("is negative once the viewport has scrolled past the bottom edge", () => {
    expect(distanceFromBottom(metrics({ contentOffsetY: 700 }))).toBe(-100);
  });

  it("is positive when scrolled up away from the bottom", () => {
    expect(distanceFromBottom(metrics({ contentOffsetY: 200 }))).toBe(400);
  });
});

describe("isNearBottom", () => {
  it("is true at the very bottom", () => {
    expect(isNearBottom(metrics({}))).toBe(true);
  });

  it("is true when the slack is positive but scrollable tip is small", () => {
    // 50px remains below the viewport — inside the 80px slack.
    expect(isNearBottom(metrics({ contentOffsetY: 550 }))).toBe(true);
  });

  it("is false when scrolled up beyond the slack band", () => {
    // 200px remains below the viewport — well outside the slack.
    expect(isNearBottom(metrics({ contentOffsetY: 400 }))).toBe(false);
  });

  it("honours a custom slack band", () => {
    const tighter = { slackPx: 20 };
    // 50px remains — true with 80px slack, false with 20px slack.
    expect(isNearBottom(metrics({ contentOffsetY: 550, ...tighter }))).toBe(
      false,
    );
  });

  it("treats an empty (0-content) list as at-bottom", () => {
    expect(
      isNearBottom({
        contentOffsetY: 0,
        contentHeight: 0,
        viewportHeight: 0,
        slackPx: 80,
      }),
    ).toBe(true);
  });
});