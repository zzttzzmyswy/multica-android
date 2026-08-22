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
  isNearTop,
  nextFabVisibility,
  nextJumpTopFabVisibility,
  wantJumpFab,
  wantJumpTopFab,
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

describe("wantJumpFab", () => {
  it("is false when at the bottom", () => {
    expect(wantJumpFab(metrics({}))).toBe(false);
  });

  it("is true when scrolled up away from the bottom", () => {
    expect(wantJumpFab(metrics({ contentOffsetY: 400 }))).toBe(true);
  });
});

describe("nextFabVisibility", () => {
  const hidden = metrics({}); // at bottom → FAB hidden
  const shown = metrics({ contentOffsetY: 200 }); // scrolled up → FAB shown

  it("stays hidden when a scroll sample keeps the user at the bottom", () => {
    expect(nextFabVisibility(false, hidden)).toBe(false);
  });

  it("stays shown when a scroll sample keeps the user scrolled up", () => {
    expect(nextFabVisibility(true, shown)).toBe(true);
  });

  it("shows the FAB once the user scrolls up away from the bottom", () => {
    expect(nextFabVisibility(false, shown)).toBe(true);
  });

  it("hides the FAB once the user returns to the bottom", () => {
    expect(nextFabVisibility(true, hidden)).toBe(false);
  });
});

describe("isNearTop", () => {
  it("is true at the very top", () => {
    expect(isNearTop(metrics({ contentOffsetY: 0 }))).toBe(true);
  });

  it("is true on pull-to-refresh overscroll (negative offset)", () => {
    expect(isNearTop(metrics({ contentOffsetY: -30 }))).toBe(true);
  });

  it("is true while the top scrollable tip is within the slack band", () => {
    // 50px scrolled — inside the 80px top slack.
    expect(isNearTop(metrics({ contentOffsetY: 50 }))).toBe(true);
  });

  it("is false once scrolled past the top slack band", () => {
    expect(isNearTop(metrics({ contentOffsetY: 200 }))).toBe(false);
  });

  it("honours a custom top slack band", () => {
    const tighter = { topSlackPx: 20 };
    // 50px scrolled — true with 80px slack, false with 20px slack.
    expect(isNearTop(metrics({ contentOffsetY: 50, ...tighter }))).toBe(false);
  });
});

describe("wantJumpTopFab", () => {
  it("is false at the top — the button is pointless", () => {
    expect(wantJumpTopFab(metrics({ contentOffsetY: 0 }))).toBe(false);
  });

  it("is false at the bottom — keeps the caught-up state clean", () => {
    expect(wantJumpTopFab(metrics({}))).toBe(false);
  });

  it("is false just above the bottom edge band", () => {
    // 50px remains below the viewport — inside the 80px bottom slack.
    expect(wantJumpTopFab(metrics({ contentOffsetY: 550 }))).toBe(false);
  });

  it("is true in the middle band, away from both edges", () => {
    expect(wantJumpTopFab(metrics({ contentOffsetY: 300 }))).toBe(true);
  });

  it("is true just below the top slack band", () => {
    // 100px scrolled — outside the 80px top slack, far from the bottom.
    expect(wantJumpTopFab(metrics({ contentOffsetY: 100 }))).toBe(true);
  });
});

describe("nextJumpTopFabVisibility", () => {
  const atTop = metrics({ contentOffsetY: 0 });
  const atBottom = metrics({});
  const middle = metrics({ contentOffsetY: 300 });

  it("stays hidden when a scroll sample keeps the user at the top", () => {
    expect(nextJumpTopFabVisibility(false, atTop)).toBe(false);
  });

  it("stays hidden when a scroll sample keeps the user at the bottom", () => {
    expect(nextJumpTopFabVisibility(false, atBottom)).toBe(false);
  });

  it("stays shown when a scroll sample keeps the user in the middle", () => {
    expect(nextJumpTopFabVisibility(true, middle)).toBe(true);
  });

  it("shows the button once the user enters the middle band", () => {
    expect(nextJumpTopFabVisibility(false, middle)).toBe(true);
  });

  it("hides the button once the user returns to the top", () => {
    expect(nextJumpTopFabVisibility(true, atTop)).toBe(false);
  });

  it("hides the button once the user reaches the bottom", () => {
    expect(nextJumpTopFabVisibility(true, atBottom)).toBe(false);
  });
});
