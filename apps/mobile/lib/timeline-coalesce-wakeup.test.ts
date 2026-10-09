import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@multica/core/types";
import { coalesceTimeline } from "./timeline-coalesce";

// Iteration 214 (MYS-2023). Web's coalescer (issue-detail.tsx:1680-1692) has
// carried wakeup-aware sets since the wakeup subsystem landed; mobile's copy
// never learned them, so the two clients disagreed about how many rows an
// issue's timeline has — the "counts must agree" rule in apps/mobile/CLAUDE.md.
//
// Three separate disagreements, each with its own consequence:
//   1. `wakeup_checkin` has no time limit on web (a rule checking in hourly for
//      a day is ONE row with a ×24 chip). Mobile's 2-minute window made it 24.
//   2. `wakeup_created` / `_triggered` / `_timed_out` / `_paused` never coalesce
//      on web — each carries its own audit facts, and merging drops them.
//   3. Mobile let them merge, so a rule that fired twice in two minutes showed
//      one row where web showed two.

function activity(over: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    type: "activity",
    id: Math.random().toString(36).slice(2),
    actor_type: "system",
    actor_id: "",
    created_at: "2026-10-09T00:00:00Z",
    ...over,
  } as TimelineEntry;
}

/** Minutes after the base timestamp, so the 2-minute window is easy to state. */
const at = (minutes: number) =>
  new Date(Date.parse("2026-10-09T00:00:00Z") + minutes * 60_000).toISOString();

describe("coalesceTimeline — wakeup actions (MYS-2023)", () => {
  it("merges a day of hourly check-ins into one row, like web", () => {
    const entries = Array.from({ length: 24 }, (_, i) =>
      activity({ action: "wakeup_checkin", created_at: at(i * 60) }),
    );
    const out = coalesceTimeline(entries);
    expect(out).toHaveLength(1);
    expect(out[0].coalesced_count).toBe(24);
  });

  it("keeps two check-ins an hour apart apart when they are not adjacent", () => {
    // The no-time-limit rule applies to *consecutive* runs only — a comment
    // between them breaks the run, exactly as web's loop does.
    const out = coalesceTimeline([
      activity({ action: "wakeup_checkin", created_at: at(0) }),
      { type: "comment", id: "c1", actor_type: "member", actor_id: "u1", created_at: at(1) } as TimelineEntry,
      activity({ action: "wakeup_checkin", created_at: at(60) }),
    ]);
    expect(out).toHaveLength(3);
  });

  it("never merges a created rule into the one before it", () => {
    const out = coalesceTimeline([
      activity({ action: "wakeup_created", created_at: at(0) }),
      activity({ action: "wakeup_created", created_at: at(1) }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("never merges triggers, timeouts or pauses — each carries audit facts", () => {
    for (const action of [
      "wakeup_triggered",
      "wakeup_timed_out",
      "wakeup_paused",
    ]) {
      const out = coalesceTimeline([
        activity({ action, created_at: at(0) }),
        activity({ action, created_at: at(1) }),
      ]);
      expect(out, `${action} must not coalesce`).toHaveLength(2);
    }
  });

  it("still merges the pre-existing no-time-limit task actions", () => {
    // The rule this change must not break.
    const out = coalesceTimeline([
      activity({ action: "task_completed", created_at: at(0) }),
      activity({ action: "task_completed", created_at: at(600) }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].coalesced_count).toBe(2);
  });

  it("still merges ordinary activities inside the 2-minute window", () => {
    const out = coalesceTimeline([
      activity({ action: "status_changed", created_at: at(0) }),
      activity({ action: "status_changed", created_at: at(1) }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("still refuses to merge squad evaluations", () => {
    const out = coalesceTimeline([
      activity({ action: "squad_leader_evaluated", created_at: at(0) }),
      activity({ action: "squad_leader_evaluated", created_at: at(1) }),
    ]);
    expect(out).toHaveLength(2);
  });
});
