/**
 * Unit tests for the swimlane lane model (`lib/swimlane.ts`) — the mobile
 * half of web's `swimlane-view.tsx` lane builders. Asserts the pinned-lane
 * rules, lane ordering, per-status cell alignment, and the move patches the
 * swimlane card menu writes.
 */
import { describe, expect, it } from "vitest";
import type { Issue, IssueStatus } from "@multica/core/types";
import {
  buildSwimlaneLanes,
  laneMovePatch,
  SWIMLANE_NONE_ID,
  SWIMLANE_ORPHAN_ID,
  type SwimlaneLane,
} from "./swimlane";
import { BOARD_STATUSES } from "./issue-status-core";

function issue(partial: Partial<Issue>): Issue {
  const { id = "x" } = partial;
  return {
    id,
    title: partial.title ?? `Issue ${id}`,
    identifier: partial.identifier ?? `MYS-${id}`,
    number: partial.number ?? 1,
    status: partial.status ?? "todo",
    priority: partial.priority ?? "none",
    position: partial.position ?? 0,
    created_at: partial.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: partial.updated_at ?? "2026-01-01T00:00:00Z",
    assignee_type: partial.assignee_type ?? null,
    assignee_id: partial.assignee_id ?? null,
    creator_type: partial.creator_type,
    creator_id: partial.creator_id,
    parent_issue_id: partial.parent_issue_id ?? null,
    project_id: partial.project_id ?? null,
    labels: partial.labels,
    properties: partial.properties,
    start_date: partial.start_date,
    due_date: partial.due_date,
  } as Issue;
}

const laneByRaw = (lanes: SwimlaneLane[], rawId: string): SwimlaneLane => {
  const lane = lanes.find((l) => l.rawId === rawId);
  if (!lane) throw new Error(`no lane ${rawId} in ${lanes.map((l) => l.key).join(", ")}`);
  return lane;
};

describe("buildSwimlaneLanes — assignee grouping", () => {
  const issues = [
    issue({ id: "1", assignee_type: "agent", assignee_id: "a2" }),
    issue({ id: "2", assignee_type: "member", assignee_id: "m1" }),
    issue({ id: "3", assignee_type: "member", assignee_id: "m1", status: "done" }),
    issue({ id: "4" }),
  ];

  it("pins the unassigned lane first and always renders it", () => {
    const lanes = buildSwimlaneLanes({
      issues,
      grouping: "assignee",
      statusOrder: BOARD_STATUSES,
      actorName: (type, id) => `${type}:${id}`,
    });
    expect(lanes[0].key).toBe(`assignee:${SWIMLANE_NONE_ID}`);
    expect(lanes[0].pinned).toBe(true);
    expect(lanes[0].total).toBe(1);
    expect(lanes[0].cells.flatMap((c) => c.issues).map((i) => i.id)).toEqual(["4"]);
  });

  it("renders the unassigned lane even when nothing is unassigned", () => {
    const lanes = buildSwimlaneLanes({
      issues: [issue({ id: "1", assignee_type: "member", assignee_id: "m1" })],
      grouping: "assignee",
      statusOrder: BOARD_STATUSES,
    });
    expect(lanes).toHaveLength(2);
    expect(lanes[0].total).toBe(0);
  });

  it("orders lanes member → agent → squad, then by resolved name", () => {
    const lanes = buildSwimlaneLanes({
      issues: [
        issue({ id: "1", assignee_type: "squad", assignee_id: "s1" }),
        issue({ id: "2", assignee_type: "agent", assignee_id: "a1" }),
        issue({ id: "3", assignee_type: "agent", assignee_id: "a2" }),
        issue({ id: "4", assignee_type: "member", assignee_id: "m1" }),
      ],
      grouping: "assignee",
      statusOrder: BOARD_STATUSES,
      actorName: (_type, id) => (id === "a1" ? "zulu" : id === "a2" ? "alpha" : id),
    });
    const keys = lanes.map((l) => l.key);
    expect(keys).toEqual([
      `assignee:${SWIMLANE_NONE_ID}`,
      "assignee:member:m1",
      "assignee:agent:a2", // alpha
      "assignee:agent:a1", // zulu
      "assignee:squad:s1",
    ]);
  });

  it("keeps one cell per status in statusOrder and counts the lane", () => {
    const lanes = buildSwimlaneLanes({
      issues,
      grouping: "assignee",
      statusOrder: BOARD_STATUSES,
      actorName: (type, id) => `${type}:${id}`,
    });
    const m1 = laneByRaw(lanes, "member:m1");
    expect(m1.cells.map((c) => c.status)).toEqual(BOARD_STATUSES);
    expect(m1.total).toBe(2);
    const done = m1.cells.find((c) => c.status === "done")!;
    expect(done.issues.map((i) => i.id)).toEqual(["3"]);
    // Empty cells are real cells — the move menu's targets.
    expect(m1.cells.find((c) => c.status === "blocked")!.issues).toEqual([]);
  });

  it("drops issues whose status has no column (unknown status contract)", () => {
    const lanes = buildSwimlaneLanes({
      issues: [
        issue({
          id: "1",
          status: "some_custom_status" as IssueStatus,
          assignee_type: "member",
          assignee_id: "m1",
        }),
      ],
      grouping: "assignee",
      statusOrder: BOARD_STATUSES,
    });
    expect(lanes).toHaveLength(1); // the pinned lane only
    expect(lanes[0].total).toBe(0);
  });
});

describe("buildSwimlaneLanes — project grouping", () => {
  it("pins the no-project lane first and orders by project title", () => {
    const lanes = buildSwimlaneLanes({
      issues: [
        issue({ id: "1", project_id: "p1" }),
        issue({ id: "2", project_id: "p2" }),
        issue({ id: "3" }),
      ],
      grouping: "project",
      statusOrder: BOARD_STATUSES,
      projectTitle: (id) => (id === "p1" ? "Zeta" : "Alpha"),
    });
    expect(lanes.map((l) => l.key)).toEqual([
      `project:${SWIMLANE_NONE_ID}`,
      "project:p2", // Alpha
      "project:p1", // Zeta
    ]);
    expect(lanes[0].cells.flatMap((c) => c.issues).map((i) => i.id)).toEqual(["3"]);
  });

  it("falls back to first appearance when no title resolver is given", () => {
    const lanes = buildSwimlaneLanes({
      issues: [
        issue({ id: "1", project_id: "p2" }),
        issue({ id: "2", project_id: "p1" }),
      ],
      grouping: "project",
      statusOrder: BOARD_STATUSES,
    });
    expect(lanes.map((l) => l.rawId)).toEqual([SWIMLANE_NONE_ID, "p2", "p1"]);
  });
});

describe("buildSwimlaneLanes — parent grouping", () => {
  it("pins no-parent first, then orphan, then known parents in order", () => {
    const lanes = buildSwimlaneLanes({
      issues: [
        issue({ id: "1", parent_issue_id: "P1" }),
        issue({ id: "2", parent_issue_id: "P2" }),
        issue({ id: "3", parent_issue_id: "P9" }), // metadata not loaded
        issue({ id: "4" }),
      ],
      grouping: "parent",
      statusOrder: BOARD_STATUSES,
      knownParentIds: new Set(["P1", "P2"]),
    });
    expect(lanes.map((l) => l.key)).toEqual([
      `parent:${SWIMLANE_NONE_ID}`,
      `parent:${SWIMLANE_ORPHAN_ID}`,
      "parent:P1",
      "parent:P2",
    ]);
    expect(lanes[1].orphan).toBe(true);
    expect(lanes[1].total).toBe(1);
    expect(lanes[0].cells.flatMap((c) => c.issues).map((i) => i.id)).toEqual(["4"]);
  });

  it("omits the orphan lane when every parent is known", () => {
    const lanes = buildSwimlaneLanes({
      issues: [issue({ id: "1", parent_issue_id: "P1" })],
      grouping: "parent",
      statusOrder: BOARD_STATUSES,
      knownParentIds: new Set(["P1"]),
    });
    expect(lanes.map((l) => l.key)).toEqual([
      `parent:${SWIMLANE_NONE_ID}`,
      "parent:P1",
    ]);
  });
});

describe("buildSwimlaneLanes — degenerate input", () => {
  it("returns just the pinned lane for an empty issue set", () => {
    for (const grouping of ["assignee", "project", "parent"] as const) {
      const lanes = buildSwimlaneLanes({
        issues: [],
        grouping,
        statusOrder: BOARD_STATUSES,
      });
      expect(lanes).toHaveLength(1);
      expect(lanes[0].pinned).toBe(true);
      expect(lanes[0].total).toBe(0);
      expect(lanes[0].cells).toHaveLength(BOARD_STATUSES.length);
    }
  });
});

describe("laneMovePatch", () => {
  it("clears the dimension for the pinned lane of each grouping", () => {
    for (const grouping of ["assignee", "project", "parent"] as const) {
      const [pinned] = buildSwimlaneLanes({
        issues: [],
        grouping,
        statusOrder: BOARD_STATUSES,
      });
      const patch = laneMovePatch(pinned);
      expect(Object.values(patch).every((v) => v === null)).toBe(true);
    }
  });

  it("writes the lane's value for a value lane", () => {
    const issueA = issue({
      id: "1",
      assignee_type: "agent",
      assignee_id: "a1",
    });
    const [assignedLane] = buildSwimlaneLanes({
      issues: [issueA],
      grouping: "assignee",
      statusOrder: BOARD_STATUSES,
    }).slice(1);
    expect(laneMovePatch(assignedLane)).toEqual({
      assignee_type: "agent",
      assignee_id: "a1",
    });

    const projectLane = laneByRaw(
      buildSwimlaneLanes({
        issues: [issue({ id: "1", project_id: "p1" })],
        grouping: "project",
        statusOrder: BOARD_STATUSES,
      }),
      "p1",
    );
    expect(laneMovePatch(projectLane)).toEqual({ project_id: "p1" });

    const parentLane = laneByRaw(
      buildSwimlaneLanes({
        issues: [issue({ id: "1", parent_issue_id: "P1" })],
        grouping: "parent",
        statusOrder: BOARD_STATUSES,
        knownParentIds: new Set(["P1"]),
      }),
      "P1",
    );
    expect(laneMovePatch(parentLane)).toEqual({ parent_issue_id: "P1" });
  });
});
