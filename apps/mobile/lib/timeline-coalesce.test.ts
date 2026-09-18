import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@multica/core/types";
import { coalesceTimeline } from "./timeline-coalesce";

/**
 * Guard for the *input range* of the coalesce, which is what web's
 * `issue-detail.tsx` pins: it coalesces `topLevel` — activities and root
 * comments — and a reply is rendered nested under its parent, so it never
 * interrupts a run of identical activities.
 *
 * Mobile coalesced the flat array instead, so `[activity A, reply R,
 * activity A]` stayed two rows on the phone where web shows one row with a
 * ×2 chip. The probe issue MYS-1271 reproduces it end to end: root comment,
 * status change, reply, status change.
 */

const T0 = Date.parse("2026-09-19T00:20:00.000Z");

function activity(seq: number, action = "status_changed"): TimelineEntry {
  return {
    id: `a${seq}`,
    type: "activity",
    action,
    actor_type: "agent",
    actor_id: "agent-1",
    created_at: new Date(T0 + seq * 1000).toISOString(),
  } as TimelineEntry;
}

function comment(seq: number, parentId?: string): TimelineEntry {
  return {
    id: `c${seq}`,
    type: "comment",
    parent_id: parentId,
    created_at: new Date(T0 + seq * 1000).toISOString(),
  } as TimelineEntry;
}

describe("coalesceTimeline", () => {
  it("merges identical activities that a reply sits between", () => {
    const entries = [
      comment(0),
      activity(1),
      comment(2, "c0"),
      activity(3),
    ];

    const coalesced = coalesceTimeline(entries);

    // One activity row, carrying the newer entry's body at the earlier
    // position (web replaces in place the same way), and the reply still
    // sitting after it — it renders nested under `c0` either way.
    expect(coalesced.map((e) => e.id)).toEqual(["c0", "a3", "c2"]);
    expect(coalesced[1]?.coalesced_count).toBe(2);
  });

  it("still merges plain adjacent activities", () => {
    const coalesced = coalesceTimeline([activity(1), activity(2)]);
    expect(coalesced).toHaveLength(1);
    expect(coalesced[0]?.coalesced_count).toBe(2);
  });

  it("does not merge across a root comment", () => {
    const coalesced = coalesceTimeline([
      activity(1),
      comment(2),
      activity(3),
    ]);
    expect(coalesced.map((e) => e.id)).toEqual(["a1", "c2", "a3"]);
  });

  it("does not merge across a different action or actor", () => {
    expect(coalesceTimeline([activity(1), activity(2, "assigned")])).toHaveLength(2);
    const other = { ...activity(2), actor_id: "agent-2" } as TimelineEntry;
    expect(coalesceTimeline([activity(1), other])).toHaveLength(2);
  });

  it("keeps merging into the same row after a reply interrupts the run", () => {
    const coalesced = coalesceTimeline([
      activity(1),
      comment(2, "c0"),
      activity(3),
      comment(4, "c0"),
      activity(5),
    ]);

    expect(coalesced.filter((e) => e.type === "activity")).toHaveLength(1);
    expect(coalesced.find((e) => e.type === "activity")?.coalesced_count).toBe(3);
  });
});
