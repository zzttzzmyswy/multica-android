import { describe, expect, it } from "vitest";
import {
  LEADERBOARD_LIMIT,
  leaderboardView,
  isOpenableLeaderboardRow,
} from "./usage-leaderboard";
import { DELETED_AGENTS_ROW_ID, RESTRICTED_AGENTS_ROW_ID } from "./usage-format";

const row = (agentId: string) => ({ agentId });
const rows = (n: number) => Array.from({ length: n }, (_, i) => row(`agent-${i}`));

describe("leaderboardView", () => {
  it("keeps a short list intact and offers no toggle", () => {
    const view = leaderboardView(rows(3), false, 0);
    expect(view.rows).toHaveLength(3);
    expect(view.hidden).toBe(0);
    expect(view.collapsible).toBe(false);
  });

  it("collapses a long list to the limit", () => {
    const view = leaderboardView(rows(25), false, 0);
    expect(view.rows).toHaveLength(LEADERBOARD_LIMIT);
    expect(view.hidden).toBe(25 - LEADERBOARD_LIMIT);
    expect(view.collapsible).toBe(true);
  });

  it("shows everything once expanded, hiding nothing", () => {
    const view = leaderboardView(rows(25), true, 0);
    expect(view.rows).toHaveLength(25);
    expect(view.hidden).toBe(0);
    expect(view.collapsible).toBe(true);
  });

  // A list of exactly the limit is not "collapsed" — a toggle that reveals
  // nothing is worse than no toggle.
  it("does not offer a toggle at exactly the limit", () => {
    const view = leaderboardView(rows(LEADERBOARD_LIMIT), false, 0);
    expect(view.rows).toHaveLength(LEADERBOARD_LIMIT);
    expect(view.collapsible).toBe(false);
    expect(view.hidden).toBe(0);
  });

  it("offers a toggle one row past the limit", () => {
    const view = leaderboardView(rows(LEADERBOARD_LIMIT + 1), false, 0);
    expect(view.rows).toHaveLength(LEADERBOARD_LIMIT);
    expect(view.hidden).toBe(1);
    expect(view.collapsible).toBe(true);
  });

  // The caption counts agents, so the two synthetic buckets must not inflate
  // it. This is the bug web fixed by filtering rather than subtracting 1.
  it("counts only rows that name a real agent", () => {
    const view = leaderboardView(
      [row("agent-1"), row(DELETED_AGENTS_ROW_ID), row(RESTRICTED_AGENTS_ROW_ID)],
      false,
      0,
    );
    expect(view.namedCount).toBe(1);
  });

  it("counts named agents across the whole list, not just the visible ones", () => {
    const view = leaderboardView([...rows(20), row(DELETED_AGENTS_ROW_ID)], false, 0);
    expect(view.namedCount).toBe(20);
  });

  it("reports the deleted bucket's own count, not the row count", () => {
    const view = leaderboardView([row("agent-1"), row(DELETED_AGENTS_ROW_ID)], false, 7);
    expect(view.deletedCount).toBe(7);
  });

  // The deleted count is derived from the merged rows; a missing or negative
  // value must not render as "-1 deleted".
  it("floors a missing or negative deleted count at zero", () => {
    expect(leaderboardView(rows(2), false, -3).deletedCount).toBe(0);
  });

  it("preserves the incoming row order", () => {
    const view = leaderboardView([row("b"), row("a"), row("c")], false, 0);
    expect(view.rows.map((r) => r.agentId)).toEqual(["b", "a", "c"]);
  });

  it("handles an empty list", () => {
    const view = leaderboardView([], false, 0);
    expect(view.rows).toEqual([]);
    expect(view.namedCount).toBe(0);
    expect(view.collapsible).toBe(false);
  });
});

describe("isOpenableLeaderboardRow", () => {
  it("opens a row backed by a real agent", () => {
    expect(isOpenableLeaderboardRow("agent-1")).toBe(true);
  });

  it("does not open either synthetic bucket", () => {
    expect(isOpenableLeaderboardRow(DELETED_AGENTS_ROW_ID)).toBe(false);
    expect(isOpenableLeaderboardRow(RESTRICTED_AGENTS_ROW_ID)).toBe(false);
  });
});
