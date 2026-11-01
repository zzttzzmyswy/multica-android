/**
 * Pins for the Stack-header title budget (MYS-2534).
 *
 * The defect: the issue detail header put its actions beside a title that
 * React Navigation sizes LAST, and on a 411dp phone the identifier was
 * allotted 76dp against the 88dp it needs — it rendered as "MYS-…". Nothing
 * failed; the header was simply over-subscribed, and no test could see it
 * because the arithmetic only existed inside a JSX literal.
 *
 * The constants here are MEASURED from a device (`uiautomator dump` node
 * bounds, 1080px @ density 2.625), and the first case re-derives the shipped
 * bug from those measurements so the numbers cannot quietly drift back to a
 * comfortable guess.
 */
import { describe, expect, it } from "vitest";
import {
  HEADER_ACTION_FOOTPRINT,
  HEADER_ACTION_GAP,
  HEADER_ACTION_SIZE,
  HEADER_AGENT_BADGE_WIDTH,
  HEADER_LEADING_WIDTH,
  HEADER_TOUCH_TARGET,
  HEADER_TRAILING_PADDING,
  HEADER_WAKEUP_BADGE_WIDTH,
  MIN_SCREEN_WIDTH,
  MIN_TITLE_WIDTH,
  actionsWidth,
  headerActionBudget,
  headerTitleFits,
  headerTitleWidth,
} from "./header-title-budget";

/** The phone the defect was measured on: 1080px at density 440 = 392.7dp. */
const DEFECT_SCREEN_WIDTH = 1080 / 2.75;

describe("the measured constants reproduce the shipped defect", () => {
  it("allots the title less than it needs on the reporting phone", () => {
    // Exactly the composition the user saw: search, threadNav, find, archive,
    // agent badge (no inbox archive, no wakeup badge), overflow.
    const trailing = actionsWidth([
      HEADER_ACTION_FOOTPRINT,
      HEADER_ACTION_FOOTPRINT,
      HEADER_ACTION_FOOTPRINT,
      HEADER_ACTION_FOOTPRINT,
      HEADER_AGENT_BADGE_WIDTH,
      HEADER_ACTION_FOOTPRINT,
    ]);
    const titleWidth = headerTitleWidth(DEFECT_SCREEN_WIDTH, trailing);
    // 72.7dp against the 80dp floor — "MYS-2282" ellipsised. The measured lane
    // on the device was 72.7dp, so this reproduces the report from the
    // constants rather than asserting a remembered number.
    expect(Math.round(titleWidth * 10) / 10).toBeCloseTo(72.7, 1);
    expect(titleWidth).toBeLessThan(MIN_TITLE_WIDTH);
    expect(headerTitleFits(DEFECT_SCREEN_WIDTH, trailing)).toBe(false);
  });

  it("models the reported six-item bar at the device's real width", () => {
    // search + threadNav + find + archive + agentBadge + overflow = 232dp.
    const trailing = actionsWidth([
      HEADER_ACTION_FOOTPRINT,
      HEADER_ACTION_FOOTPRINT,
      HEADER_ACTION_FOOTPRINT,
      HEADER_ACTION_FOOTPRINT,
      HEADER_AGENT_BADGE_WIDTH,
      HEADER_ACTION_FOOTPRINT,
    ]);
    expect(trailing).toBe(232);
    expect(headerTitleFits(DEFECT_SCREEN_WIDTH, trailing)).toBe(false);
  });

  it("explains why a count of actions was not enough", () => {
    // The bug survived a first fix that budgeted in COUNTS, because the badge
    // is not a button: one badge costs more than one button, so "six actions"
    // can cost seven buttons' worth of width.
    expect(HEADER_AGENT_BADGE_WIDTH).toBeGreaterThan(HEADER_ACTION_FOOTPRINT);
    expect(HEADER_WAKEUP_BADGE_WIDTH).toBeGreaterThan(HEADER_AGENT_BADGE_WIDTH);
  });
});

describe("actionsWidth", () => {
  it("is zero with no actions", () => {
    expect(actionsWidth([])).toBe(0);
  });

  it("does not add a trailing gap after the last action", () => {
    expect(actionsWidth([HEADER_ACTION_FOOTPRINT])).toBe(HEADER_ACTION_FOOTPRINT);
    expect(actionsWidth([HEADER_ACTION_FOOTPRINT, HEADER_ACTION_FOOTPRINT])).toBe(
      HEADER_ACTION_FOOTPRINT * 2 + HEADER_ACTION_GAP,
    );
  });
});

describe("headerTitleWidth", () => {
  it("subtracts the leading lane, the trailing inset and the actions", () => {
    expect(headerTitleWidth(411, 100)).toBe(
      411 - HEADER_LEADING_WIDTH - HEADER_TRAILING_PADDING - 100,
    );
  });

  it("goes negative on an over-subscribed header instead of clamping", () => {
    // Clamping would hide the defect; a negative width is the honest answer
    // and is what makes `headerTitleFits` a real guard.
    expect(headerTitleWidth(MIN_SCREEN_WIDTH, 600)).toBeLessThan(0);
  });
});

describe("headerActionBudget", () => {
  it("leaves room for the title at every supported width", () => {
    for (const width of [MIN_SCREEN_WIDTH, 393, 411, 480]) {
      expect(headerActionBudget(width)).toBeGreaterThan(0);
    }
  });

  it("shrinks as the screen narrows", () => {
    expect(headerActionBudget(360)).toBeLessThan(headerActionBudget(411));
  });
});

describe("touch target", () => {
  it("keeps the accessible tappable size even though the visual box shrank", () => {
    // The user's complaint was that the buttons LOOK airy. The fix shrinks the
    // visual box; the tappable box must not shrink with it.
    expect(HEADER_ACTION_SIZE).toBeLessThan(HEADER_TOUCH_TARGET);
    expect(HEADER_TOUCH_TARGET).toBeGreaterThanOrEqual(44);
  });
});
