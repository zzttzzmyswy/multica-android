/**
 * Scope / filter / sort contract for the autopilots list — pinned against
 * web's `autopilots-page.tsx` (`scopeCounts` :651-660, `scopeRows` :664-669,
 * `rows` :672-725), including the two sort asymmetries that are easy to
 * "tidy up" into a bug:
 *
 *   - `lastRun`: a never-ran row is the OLDEST (epoch 0), and equal timestamps
 *     tie-break on title ASCENDING regardless of the chosen direction;
 *   - `nextRun`: a missing next run sorts LAST in either direction, because an
 *     unscheduled autopilot is not "the soonest".
 */
import { describe, expect, it } from "vitest";
import type { Autopilot } from "@multica/core/types";
import {
  AUTOPILOT_MODES,
  AUTOPILOT_SCOPES,
  AUTOPILOT_SORT_DEFAULT_DIRECTION,
  EMPTY_AUTOPILOT_FILTERS,
  actorFilterValue,
  autopilotFilterKey,
  autopilotScopeCounts,
  autopilotScopeRows,
  countActiveAutopilotFilterDimensions,
  filterAutopilotRows,
  parseAutopilotFilterKey,
  sortAutopilotRows,
  toggleAutopilotFilter,
} from "./filter-autopilots";

function autopilot(over: Partial<Autopilot> & { id: string }): Autopilot {
  return {
    workspace_id: "ws",
    title: over.id,
    description: null,
    assignee_type: "agent",
    assignee_id: "a1",
    status: "active",
    execution_mode: "create_issue",
    issue_title_template: null,
    created_by_type: "member",
    created_by_id: "u1",
    last_run_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("autopilotScopeCounts", () => {
  it("buckets by lifecycle stage and excludes archived everywhere", () => {
    const counts = autopilotScopeCounts([
      autopilot({ id: "a", status: "active" }),
      autopilot({ id: "b", status: "active" }),
      autopilot({ id: "c", status: "paused" }),
      autopilot({ id: "d", status: "archived" }),
    ]);
    expect(counts).toEqual({ all: 3, active: 2, paused: 1 });
  });

  it("treats an unknown status as active rather than dropping the row", () => {
    // The server drives this enum; a value this build has not seen must not
    // make the row disappear from every scope at once.
    const counts = autopilotScopeCounts([
      autopilot({ id: "a", status: "something_new" as Autopilot["status"] }),
    ]);
    expect(counts).toEqual({ all: 1, active: 1, paused: 0 });
  });
});

describe("autopilotScopeRows", () => {
  const rows = [
    autopilot({ id: "a", status: "active" }),
    autopilot({ id: "b", status: "paused" }),
    autopilot({ id: "c", status: "archived" }),
  ];

  it("partitions by stage, with all = everything unarchived", () => {
    expect(autopilotScopeRows(rows, "all").map((r) => r.id)).toEqual(["a", "b"]);
    expect(autopilotScopeRows(rows, "active").map((r) => r.id)).toEqual(["a"]);
    expect(autopilotScopeRows(rows, "paused").map((r) => r.id)).toEqual(["b"]);
  });

  it("offers no archived scope — no UI flow can archive one", () => {
    expect(AUTOPILOT_SCOPES).toEqual(["all", "active", "paused"]);
  });
});

describe("filterAutopilotRows", () => {
  const rows = [
    autopilot({
      id: "a",
      assignee_type: "agent",
      assignee_id: "ag1",
      created_by_type: "member",
      created_by_id: "u1",
      execution_mode: "create_issue",
      trigger_kinds: ["schedule", "webhook"],
    }),
    autopilot({
      id: "b",
      assignee_type: "squad",
      assignee_id: "sq1",
      created_by_type: "member",
      created_by_id: "u2",
      execution_mode: "run_only",
      trigger_kinds: ["api"],
    }),
    autopilot({
      id: "c",
      assignee_type: "agent",
      assignee_id: "ag1",
      created_by_type: "agent",
      created_by_id: "ag1",
      execution_mode: "create_issue",
      trigger_kinds: [],
    }),
  ];

  it("returns every row when nothing is selected", () => {
    expect(filterAutopilotRows(rows, EMPTY_AUTOPILOT_FILTERS)).toHaveLength(3);
  });

  it("matches the polymorphic actor dimensions on type AND id", () => {
    expect(
      filterAutopilotRows(rows, {
        ...EMPTY_AUTOPILOT_FILTERS,
        assignees: [actorFilterValue("agent", "ag1")],
      }).map((r) => r.id),
    ).toEqual(["a", "c"]);
    // Same id, different type — must not match.
    expect(
      filterAutopilotRows(rows, {
        ...EMPTY_AUTOPILOT_FILTERS,
        assignees: [actorFilterValue("squad", "ag1")],
      }),
    ).toEqual([]);
  });

  it("matches a row carrying ANY of the selected trigger kinds", () => {
    expect(
      filterAutopilotRows(rows, {
        ...EMPTY_AUTOPILOT_FILTERS,
        triggerKinds: ["webhook", "api"],
      }).map((r) => r.id),
    ).toEqual(["a", "b"]);
  });

  it("treats a row with no trigger kinds as matching none of them", () => {
    expect(
      filterAutopilotRows(rows, {
        ...EMPTY_AUTOPILOT_FILTERS,
        triggerKinds: ["api"],
      }).map((r) => r.id),
    ).toEqual(["b"]);
  });

  it("ANDs across dimensions and ORs within one", () => {
    expect(
      filterAutopilotRows(rows, {
        ...EMPTY_AUTOPILOT_FILTERS,
        assignees: [actorFilterValue("agent", "ag1")],
        modes: ["create_issue", "run_only"],
      }).map((r) => r.id),
    ).toEqual(["a", "c"]);
    expect(
      filterAutopilotRows(rows, {
        ...EMPTY_AUTOPILOT_FILTERS,
        assignees: [actorFilterValue("agent", "ag1")],
        creators: [actorFilterValue("agent", "ag1")],
      }).map((r) => r.id),
    ).toEqual(["c"]);
  });

  it("does not reorder or mutate the caller's array", () => {
    const input = [...rows];
    filterAutopilotRows(input, {
      ...EMPTY_AUTOPILOT_FILTERS,
      modes: ["run_only"],
    });
    expect(input.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("sortAutopilotRows", () => {
  it("sorts by title, honouring direction", () => {
    const rows = [autopilot({ id: "z" }), autopilot({ id: "a" })];
    expect(sortAutopilotRows(rows, "name", "asc").map((r) => r.id)).toEqual([
      "a",
      "z",
    ]);
    expect(sortAutopilotRows(rows, "name", "desc").map((r) => r.id)).toEqual([
      "z",
      "a",
    ]);
  });

  it("sorts a never-ran lastRun as the oldest, tie-breaking on title ascending", () => {
    const rows = [
      autopilot({ id: "never" }),
      autopilot({ id: "old", last_run_at: "2026-01-01T00:00:00Z" }),
      autopilot({ id: "new", last_run_at: "2026-02-01T00:00:00Z" }),
    ];
    // desc (the default): newest first, never-ran at the bottom.
    expect(sortAutopilotRows(rows, "lastRun", "desc").map((r) => r.id)).toEqual([
      "new",
      "old",
      "never",
    ]);
    // asc: never-ran leads, because epoch 0 IS the oldest.
    expect(sortAutopilotRows(rows, "lastRun", "asc").map((r) => r.id)).toEqual([
      "never",
      "old",
      "new",
    ]);

    // Equal timestamps tie-break on title ASCENDING in BOTH directions.
    const tied = [
      autopilot({ id: "z", last_run_at: "2026-01-01T00:00:00Z" }),
      autopilot({ id: "a", last_run_at: "2026-01-01T00:00:00Z" }),
    ];
    expect(sortAutopilotRows(tied, "lastRun", "desc").map((r) => r.id)).toEqual([
      "a",
      "z",
    ]);
  });

  it("sorts a missing nextRun LAST in either direction", () => {
    const rows = [
      autopilot({ id: "none" }),
      autopilot({ id: "soon", next_run_at: "2026-01-01T00:00:00Z" }),
      autopilot({ id: "later", next_run_at: "2026-02-01T00:00:00Z" }),
    ];
    expect(sortAutopilotRows(rows, "nextRun", "asc").map((r) => r.id)).toEqual([
      "soon",
      "later",
      "none",
    ]);
    expect(sortAutopilotRows(rows, "nextRun", "desc").map((r) => r.id)).toEqual([
      "later",
      "soon",
      "none",
    ]);
  });

  it("sorts by created date", () => {
    const rows = [
      autopilot({ id: "new", created_at: "2026-02-01T00:00:00Z" }),
      autopilot({ id: "old", created_at: "2026-01-01T00:00:00Z" }),
    ];
    expect(sortAutopilotRows(rows, "created", "desc").map((r) => r.id)).toEqual([
      "new",
      "old",
    ]);
  });

  it("never mutates the caller's array", () => {
    const rows = [autopilot({ id: "z" }), autopilot({ id: "a" })];
    sortAutopilotRows(rows, "name", "asc");
    expect(rows.map((r) => r.id)).toEqual(["z", "a"]);
  });

  it("offers a default direction per field, matching web", () => {
    expect(AUTOPILOT_SORT_DEFAULT_DIRECTION).toEqual({
      name: "asc",
      lastRun: "desc",
      nextRun: "asc",
      created: "desc",
    });
  });
});

describe("filter dimension counting and the sheet key codec", () => {
  it("counts active dimensions, not selected values", () => {
    expect(countActiveAutopilotFilterDimensions(EMPTY_AUTOPILOT_FILTERS)).toBe(0);
    expect(
      countActiveAutopilotFilterDimensions({
        assignees: ["agent:a", "agent:b"],
        modes: ["run_only"],
        triggerKinds: [],
        creators: [],
      }),
    ).toBe(2);
  });

  it("round-trips a key through the codec", () => {
    for (const [dimension, value] of [
      ["assignees", "agent:a1"],
      ["modes", "create_issue"],
      ["triggerKinds", "schedule"],
      ["creators", "member:u1"],
    ] as const) {
      expect(parseAutopilotFilterKey(autopilotFilterKey(dimension, value))).toEqual(
        { dimension, value },
      );
    }
  });

  it("rejects keys that do not name a real dimension or a value", () => {
    expect(parseAutopilotFilterKey("nope:x")).toBeNull();
    expect(parseAutopilotFilterKey("assignees:")).toBeNull();
    expect(parseAutopilotFilterKey("assignees")).toBeNull();
    expect(parseAutopilotFilterKey(":x")).toBeNull();
  });

  it("keeps a value that itself contains a colon", () => {
    // Actor values ARE "type:id", so the codec must split on the FIRST colon.
    expect(
      parseAutopilotFilterKey(autopilotFilterKey("assignees", "agent:a1")),
    ).toEqual({ dimension: "assignees", value: "agent:a1" });
  });

  it("toggles one value without mutating the input filters", () => {
    const before = EMPTY_AUTOPILOT_FILTERS;
    const added = toggleAutopilotFilter(before, "modes", "run_only");
    expect(added.modes).toEqual(["run_only"]);
    expect(before.modes).toEqual([]);
    expect(toggleAutopilotFilter(added, "modes", "run_only").modes).toEqual([]);
  });

  it("exposes both structural modes", () => {
    expect(AUTOPILOT_MODES).toEqual(["create_issue", "run_only"]);
  });
});
