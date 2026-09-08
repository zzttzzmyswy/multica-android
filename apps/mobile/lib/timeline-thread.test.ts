import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@multica/core/types";
import { buildTimelineRows } from "./timeline-thread";

function comment(partial: { id: string; created_at: string; parent_id?: string | null }): TimelineEntry {
  return {
    type: "comment",
    id: partial.id,
    actor_type: "user",
    actor_id: "u1",
    content: `c-${partial.id}`,
    created_at: partial.created_at,
    updated_at: partial.created_at,
    parent_id: partial.parent_id ?? null,
  };
}

describe("buildTimelineRows reply ordering", () => {
  it("orders replies chronologically even when BFS layout would disagree", () => {
    // A's direct replies are B then C (in scan order), and B has a reply D
    // whose timestamp is EARLIER than C. BFS would emit [B, C, D], but the
    // chronological order is [B, D, C]. The bundle must be time-ordered so
    // the newest reply stays at the bottom of the bubble.
    const entries = [
      comment({ id: "A", created_at: "2026-09-01T00:00:00Z" }),
      comment({ id: "B", created_at: "2026-09-01T00:00:10Z", parent_id: "A" }),
      comment({ id: "C", created_at: "2026-09-01T00:00:30Z", parent_id: "A" }),
      comment({ id: "D", created_at: "2026-09-01T00:00:20Z", parent_id: "B" }),
    ];
    const rows = buildTimelineRows(entries);
    expect(rows).toHaveLength(1);
    expect(rows[0].entry.id).toBe("A");
    expect(rows[0].replies.map((r) => r.id)).toEqual(["B", "D", "C"]);
  });

  it("keeps same-timestamp replies stable by id (parity with appendTimelineEntry)", () => {
    const entries = [
      comment({ id: "A", created_at: "2026-09-01T00:00:00Z" }),
      // Same timestamp — deterministic order via id tiebreak.
      comment({ id: "R2", created_at: "2026-09-01T00:01:00Z", parent_id: "A" }),
      comment({ id: "R1", created_at: "2026-09-01T00:01:00Z", parent_id: "A" }),
    ];
    const rows = buildTimelineRows(entries);
    expect(rows[0].replies.map((r) => r.id)).toEqual(["R1", "R2"]);
  });

  it("resolves orphans to top level and leaves them in order", () => {
    const entries = [
      comment({ id: "A", created_at: "2026-09-01T00:00:00Z" }),
      comment({ id: "B", created_at: "2026-09-01T00:00:10Z", parent_id: "A" }),
      comment({ id: "LOST", created_at: "2026-09-01T00:00:05Z", parent_id: "MISSING" }),
    ];
    const rows = buildTimelineRows(entries);
    const ids = rows.map((r) => r.entry.id);
    expect(ids).toEqual(["A", "LOST"]);
    expect(rows[0].replies.map((r) => r.id)).toEqual(["B"]);
  });
});