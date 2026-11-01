/**
 * Pins for the issue detail header's action budget (MYS-2534).
 *
 * The behaviour under test is not "the header is smaller" — it is "the header
 * never overdraws its width, and what it gives up is chosen, not accidental".
 *
 * Widths come from `header-title-budget.ts`, which is measured on a device.
 * The cases below use the two compositions the bug report actually produced.
 */
import { describe, expect, it } from "vitest";
import {
  HEADER_ACTION_DISPLAY_ORDER,
  planHeaderActions,
  planWidth,
  type HeaderActionKey,
} from "./issue-header-actions";
import {
  HEADER_ACTION_FOOTPRINT,
  HEADER_AGENT_BADGE_WIDTH,
  HEADER_WAKEUP_BADGE_WIDTH,
  MIN_SCREEN_WIDTH,
  headerActionBudget,
} from "./header-title-budget";

const ALL: HeaderActionKey[] = [...HEADER_ACTION_DISPLAY_ORDER];

/** The composition the user reported, read off the device: search, thread
 *  navigator, find, inbox archive, agent badge, overflow — six items, of which
 *  one is a 52dp badge. */
const REPORTED: HeaderActionKey[] = [
  "search",
  "threadNav",
  "find",
  "archive",
  "agentBadge",
  "overflow",
];

describe("planHeaderActions", () => {
  it("keeps everything when the bar has room", () => {
    // A tablet-width window affords all seven.
    const plan = planHeaderActions(600, ALL);
    expect(plan.folded).toEqual([]);
    expect(plan.visible).toEqual(HEADER_ACTION_DISPLAY_ORDER);
  });

  it("folds on the phone that reported the defect", () => {
    // The device is 392.7dp; those six items cost 232dp against a 224.7dp
    // budget, so the title lane fell to 72.7dp and "MYS-2282" ellipsised.
    const plan = planHeaderActions(392.7, REPORTED);
    expect(plan.folded.length).toBeGreaterThan(0);
    expect(plan.width).toBeLessThanOrEqual(plan.budget);
  });

  it("folds on the narrowest supported phone too", () => {
    const plan = planHeaderActions(MIN_SCREEN_WIDTH, ALL);
    expect(plan.width).toBeLessThanOrEqual(plan.budget);
    expect(plan.folded.length).toBeGreaterThan(0);
  });

  it("never folds what the reader cannot reach another way", () => {
    // The defect this guards: folding `overflow` would strand every issue
    // action; folding `search` would make this the one screen without the
    // navigator-wide search entry.
    const plan = planHeaderActions(MIN_SCREEN_WIDTH, ALL);
    for (const pinned of ["overflow", "search", "agentBadge"]) {
      expect(plan.visible).toContain(pinned);
    }
  });

  it("folds the most expendable action first", () => {
    // threadNav before find before archive — each has an overflow-menu
    // equivalent, and the order is the one the module documents.
    const plan = planHeaderActions(392.7, REPORTED);
    expect(plan.folded).toEqual(["threadNav"]);
  });

  it("prefers folding a badge over folding three buttons", () => {
    // A wakeup badge is 120dp — two and a half buttons. Folding it alone can
    // rescue the title where folding buttons one at a time cannot, so the
    // planner must be willing to reach it rather than exhaust the buttons.
    const present: HeaderActionKey[] = [
      "search",
      "threadNav",
      "find",
      "agentBadge",
      "wakeupBadge",
      "overflow",
    ];
    const plan = planHeaderActions(MIN_SCREEN_WIDTH, present);
    expect(plan.width).toBeLessThanOrEqual(plan.budget);
    expect(plan.folded).toContain("wakeupBadge");
  });

  it("preserves display order in both buckets", () => {
    const plan = planHeaderActions(MIN_SCREEN_WIDTH, ALL);
    const order = (keys: HeaderActionKey[]) =>
      keys.map((k) => HEADER_ACTION_DISPLAY_ORDER.indexOf(k));
    for (const bucket of [plan.visible, plan.folded]) {
      expect(order(bucket)).toEqual([...order(bucket)].sort((a, b) => a - b));
    }
  });

  it("does not reserve width for actions that render nothing", () => {
    // The badges render null when the issue has no active task and no wakeup
    // rule. A caller that passed them anyway would fold a real button to make
    // room for an invisible one — so the caller's `present` list is the
    // contract, and absent keys cost nothing.
    const plan = planHeaderActions(411, [
      "search",
      "threadNav",
      "find",
      "overflow",
    ]);
    expect(plan.folded).toEqual([]);
    expect(plan.visible).toHaveLength(4);
  });

  it("is a no-op for a header with no actions", () => {
    const plan = planHeaderActions(MIN_SCREEN_WIDTH, []);
    expect(plan.visible).toEqual([]);
    expect(plan.folded).toEqual([]);
    expect(plan.width).toBe(0);
  });

  it("never returns an over-budget bar", () => {
    // The invariant the whole module exists for, across every composition the
    // screen can produce.
    for (const width of [320, 360, 393, 411, 480, 600]) {
      for (const present of [REPORTED, ALL]) {
        const plan = planHeaderActions(width, present);
        expect(plan.width).toBeLessThanOrEqual(headerActionBudget(width));
      }
    }
  });
});

describe("planWidth", () => {
  it("matches the per-action widths, gaps included", () => {
    expect(planWidth(["search"])).toBe(HEADER_ACTION_FOOTPRINT);
    expect(planWidth(["search", "agentBadge"])).toBe(
      HEADER_ACTION_FOOTPRINT + HEADER_AGENT_BADGE_WIDTH + 4,
    );
  });

  it("prices the wakeup badge as the widest action", () => {
    expect(planWidth(["wakeupBadge"])).toBe(HEADER_WAKEUP_BADGE_WIDTH);
    expect(HEADER_WAKEUP_BADGE_WIDTH).toBeGreaterThan(HEADER_AGENT_BADGE_WIDTH);
  });
});
