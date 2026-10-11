/**
 * Contract for the autopilots-list actions (iteration 229) — pinned against
 * web's `autopilot-list-actions.tsx` and the list page's `LastRunCell`
 * (`autopilots-page.tsx:327-373`).
 *
 * Every case here is one a plausible "tidy-up" edit gets wrong:
 *
 *   - hiding the kebab for a no-write member vs. merely disabling it;
 *   - offering BOTH batch buttons for a mixed selection (the natural
 *     simplification — "the selection is mostly paused, so offer resume" —
 *     silently strands the active rows);
 *   - PATCHing rows that already hold the target status;
 *   - formatting a null `last_run_at`, which renders "Invalid Date";
 *   - an unknown `last_run_status` collapsing to a known dot colour instead of
 *     the neutral fallback.
 */
import { describe, expect, it, vi } from "vitest";
import type { Autopilot } from "@multica/core/types";
import {
  autopilotBatchActions,
  autopilotRowActions,
  autopilotStatusPlan,
  canWriteAutopilot,
  knownRunStatus,
  lastRunCell,
  runStatusDotClass,
  runStatusLabel,
  showTriggerDash,
} from "./autopilot-list-actions";

/**
 * The subset of `Autopilot` these helpers actually read, with every field
 * required. Written as an explicit shape rather than `Partial<Autopilot>` so a
 * call site can never pass `status: undefined` and have it read as a real
 * status; the helpers take `Pick`s of this, which is what makes them usable
 * from both the list screen (a full `Autopilot`) and these cases.
 */
interface TestRow {
  id: string;
  status: Autopilot["status"];
  can_write: boolean | undefined;
  last_run_at: string | null;
  last_run_status: string | null;
}

function autopilot(over: Partial<TestRow> & { id: string }): TestRow {
  return {
    status: "active",
    can_write: true,
    last_run_at: null,
    last_run_status: null,
    ...over,
  };
}

/** The same helper with the fields the batch helpers read made explicit, so a
 *  case can pass a bare `{ id, status }` without the object literal widening
 *  `status` to `string`. */
function statusRow(
  id: string,
  status: Autopilot["status"],
): Pick<TestRow, "id" | "status"> {
  return { id, status };
}

describe("the row kebab mirrors web's write gate", () => {
  it("offers nothing at all to a member without write", () => {
    // Web returns `null` from the whole component (`:156`) — the menu is
    // hidden, never rendered-but-disabled.
    expect(autopilotRowActions(autopilot({ id: "a", can_write: false }))).toEqual(
      [],
    );
  });

  it("keeps the menu for an older server that omits can_write", () => {
    // Absent ≠ denied: the backend is the gate (the detail page reads it the
    // same way).
    expect(canWriteAutopilot({ can_write: undefined })).toBe(true);
    expect(
      autopilotRowActions(autopilot({ id: "a", can_write: undefined })),
    ).toEqual(["pause", "delete"]);
  });

  it("switches pause/resume on the row's own status", () => {
    expect(autopilotRowActions(autopilot({ id: "a", status: "active" }))).toEqual(
      ["pause", "delete"],
    );
    expect(autopilotRowActions(autopilot({ id: "a", status: "paused" }))).toEqual(
      ["resume", "delete"],
    );
  });

  it("still offers delete on an archived row", () => {
    // Web renders Delete unconditionally — an archived autopilot can only be
    // removed from the list.
    expect(
      autopilotRowActions(autopilot({ id: "a", status: "archived" })),
    ).toEqual(["delete"]);
  });
});

describe("the batch toolbar adapts to the selection's statuses", () => {
  it("offers pause when any selected row is active", () => {
    expect(
      autopilotBatchActions([statusRow("a", "active"), statusRow("b", "active")]),
    ).toEqual({ pause: true, resume: false, delete: true });
  });

  it("offers resume when any selected row is paused", () => {
    expect(
      autopilotBatchActions([statusRow("a", "paused")]),
    ).toEqual({ pause: false, resume: true, delete: true });
  });

  it("offers BOTH for a mixed selection", () => {
    // The case a "pick the majority" simplification breaks: whichever single
    // button it showed would strand every row in the other state.
    expect(
      autopilotBatchActions([
        statusRow("a", "active"),
        statusRow("b", "paused"),
        statusRow("c", "active"),
      ]),
    ).toEqual({ pause: true, resume: true, delete: true });
  });

  it("offers neither status button for an all-archived selection", () => {
    expect(autopilotBatchActions([statusRow("a", "archived")])).toEqual({
      pause: false,
      resume: false,
      delete: true,
    });
  });

  it("offers nothing for an empty selection", () => {
    // The toolbar renders only for a non-empty selection, so this is the
    // "should not be on screen at all" case.
    expect(autopilotBatchActions([])).toEqual({
      pause: false,
      resume: false,
      delete: false,
    });
  });
});

describe("a status write skips rows already in the target status", () => {
  it("sends only the rows that need the change", () => {
    const rows = [
      statusRow("a", "active"),
      statusRow("b", "paused"),
      statusRow("c", "active"),
    ];
    expect(autopilotStatusPlan(rows, "paused").map((r) => r.id)).toEqual([
      "a",
      "c",
    ]);
    expect(autopilotStatusPlan(rows, "active").map((r) => r.id)).toEqual(["b"]);
  });

  it("is empty when every row already holds the target status", () => {
    // A no-op selection must produce no requests — not a PATCH per row.
    expect(autopilotStatusPlan([statusRow("a", "paused")], "paused")).toEqual(
      [],
    );
  });
});

describe("the run-status dot mirrors web's colour map", () => {
  it("maps the five known statuses", () => {
    expect(runStatusDotClass("completed")).toBe("bg-emerald-500");
    // `issue_created` shares completed's green on the LIST; web's detail-page
    // run history paints it blue. Two surfaces, two intentional answers.
    expect(runStatusDotClass("issue_created")).toBe("bg-emerald-500");
    expect(runStatusDotClass("failed")).toBe("bg-red-500");
    expect(runStatusDotClass("skipped")).toBe("bg-amber-500");
    expect(runStatusDotClass("running")).toBe("bg-blue-500");
  });

  it("falls back to the neutral dot for enum drift and for no status", () => {
    expect(runStatusDotClass("exploded")).toBe("bg-muted-foreground/40");
    expect(runStatusDotClass(null)).toBe("bg-muted-foreground/40");
    expect(runStatusDotClass(undefined)).toBe("bg-muted-foreground/40");
  });
});

describe("run-status text falls back to the raw server value", () => {
  const t = (id: string) => `t:${id}`;

  it("translates the five known statuses", () => {
    expect(runStatusLabel("issue_created", t)).toBe(
      "t:autopilots.runStatus.issueCreated",
    );
    expect(runStatusLabel("running", t)).toBe("t:autopilots.runStatus.running");
    expect(runStatusLabel("completed", t)).toBe(
      "t:autopilots.runStatus.completed",
    );
    expect(runStatusLabel("failed", t)).toBe("t:autopilots.runStatus.failed");
    expect(runStatusLabel("skipped", t)).toBe("t:autopilots.runStatus.skipped");
  });

  it("shows the raw string for an unknown status", () => {
    // Concatenating an unknown value into a key would render the key itself.
    expect(runStatusLabel("exploded", t)).toBe("exploded");
    expect(knownRunStatus("exploded")).toBe(false);
  });

  it("returns an empty label for a missing status", () => {
    expect(runStatusLabel(null, t)).toBe("");
    expect(runStatusLabel(undefined, t)).toBe("");
  });
});

describe("the last-run cell separates 'never ran' from 'ran'", () => {
  const timeAgo = vi.fn((iso: string) => `ago:${iso}`);

  it("renders the em-dash branch for a null last_run_at", () => {
    // The defect this branch exists for: feeding null to the time formatter
    // puts "Invalid Date" on the row.
    const cell = lastRunCell(
      { last_run_at: null, last_run_status: "completed" },
      timeAgo,
    );
    expect(cell).toEqual({ kind: "absent" });
    // …and the formatter is never called, so no bogus date can leak through.
    expect(timeAgo).not.toHaveBeenCalled();
  });

  it("renders the relative time plus the status dot when it has run", () => {
    timeAgo.mockClear();
    expect(
      lastRunCell(
        { last_run_at: "2026-10-12T00:00:00Z", last_run_status: "failed" },
        timeAgo,
      ),
    ).toEqual({
      kind: "run",
      dotClass: "bg-red-500",
      label: "ago:2026-10-12T00:00:00Z",
    });
    expect(timeAgo).toHaveBeenCalledWith("2026-10-12T00:00:00Z");
  });

  it("keeps the time when the status is unknown, with the neutral dot", () => {
    expect(
      lastRunCell(
        { last_run_at: "2026-10-12T00:00:00Z", last_run_status: "exploded" },
        timeAgo,
      ),
    ).toEqual({
      kind: "run",
      dotClass: "bg-muted-foreground/40",
      label: "ago:2026-10-12T00:00:00Z",
    });
  });

  it("keeps the time when the status is absent", () => {
    expect(
      lastRunCell({ last_run_at: "2026-10-12T00:00:00Z", last_run_status: null }, timeAgo),
    ).toEqual({
      kind: "run",
      dotClass: "bg-muted-foreground/40",
      label: "ago:2026-10-12T00:00:00Z",
    });
  });
});

describe("the trigger slot never paints a duplicate em dash", () => {
  const none = { kind: "absent" } as const;
  const ran = {
    kind: "run",
    dotClass: "bg-emerald-500",
    label: "1h ago",
  } as const;

  it("dashes an empty trigger list while the row has a run time", () => {
    expect(showTriggerDash(undefined, ran)).toBe(true);
    expect(showTriggerDash([], ran)).toBe(true);
  });

  it("skips the dash when the last-run slot is ALSO empty", () => {
    // The case web never shows: it has two columns with two headers, so
    // `—  —` reads correctly there. On one phone line it reads as a fault.
    expect(showTriggerDash(undefined, none)).toBe(false);
    expect(showTriggerDash([], none)).toBe(false);
  });

  it("never dashes a row that has triggers", () => {
    expect(showTriggerDash(["schedule"], none)).toBe(false);
    expect(showTriggerDash(["schedule"], ran)).toBe(false);
    expect(showTriggerDash(["schedule", "webhook"], ran)).toBe(false);
  });
});
