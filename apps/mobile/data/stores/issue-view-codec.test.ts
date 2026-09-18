import { describe, expect, it } from "vitest";
import {
  baselineFromViewQuery,
  clearDimensionToBaseline,
  issueFilterDelta,
  sanitizeViewDisplay,
  sanitizeViewQuery,
  viewDisplayFromState,
  viewMatchesSlice,
  viewQueryFromSnapshot,
} from "./issue-view-codec";
import {
  type IssueFilterSlice,
  type IssueViewMode,
} from "./issue-filter-slice";

const SLICE: IssueFilterSlice = {
  statusFilters: ["todo", "in_progress"],
  priorityFilters: ["high"],
  assigneeFilters: [{ type: "agent", id: "ag-1" }],
  includeNoAssignee: true,
  creatorFilters: [],
  projectFilters: ["prj-1"],
  includeNoProject: false,
  labelFilters: ["label-1"],
  propertyFilters: { "prop-1": ["opt-1", "opt-2"] },
  dateFilter: null,
  workingOnly: false,
  sortBy: "priority",
  sortDirection: "desc",
  grouping: "assignee",
  showSubIssues: false,
  toggleStatusFilter: () => {},
  togglePriorityFilter: () => {},
  toggleAssigneeFilter: () => {},
  toggleNoAssignee: () => {},
  toggleCreatorFilter: () => {},
  toggleProjectFilter: () => {},
  toggleNoProject: () => {},
  toggleLabelFilter: () => {},
  togglePropertyFilter: () => {},
  clearPropertyFilter: () => {},
  setDateFilter: () => {},
  toggleWorkingOnly: () => {},
  toggleShowSubIssues: () => {},
  setSortBy: () => {},
  setSortDirection: () => {},
  setGrouping: () => {},
  clearFilters: () => {},
  resetFiltersTo: () => {},
  clearFilterDimension: () => {},
};

describe("viewQueryFromSnapshot", () => {
  it("serializes exactly the nine filter dims (no sort/grouping/date)", () => {
    const query = viewQueryFromSnapshot(SLICE);
    expect(query).toEqual({
      statusFilters: ["todo", "in_progress"],
      priorityFilters: ["high"],
      assigneeFilters: [{ type: "agent", id: "ag-1" }],
      includeNoAssignee: true,
      creatorFilters: [],
      projectFilters: ["prj-1"],
      includeNoProject: false,
      labelFilters: ["label-1"],
      propertyFilters: { "prop-1": ["opt-1", "opt-2"] },
    });
    expect(query).not.toHaveProperty("sortBy");
    expect(query).not.toHaveProperty("dateFilter");
  });
});

describe("viewDisplayFromState", () => {
  it("serializes viewMode/grouping/sortBy/sortDirection/showSubIssues only", () => {
    expect(
      viewDisplayFromState({
        view: "board",
        grouping: "assignee",
        sortBy: "priority",
        sortDirection: "desc",
        showSubIssues: false,
      }),
    ).toEqual({
      viewMode: "board",
      grouping: "assignee",
      sortBy: "priority",
      sortDirection: "desc",
      showSubIssues: false,
    });
  });

  it("keeps sub-issues visible when the display preference is on", () => {
    expect(
      viewDisplayFromState({
        view: "list",
        grouping: "status",
        sortBy: "position",
        sortDirection: "asc",
        showSubIssues: true,
      }).showSubIssues,
    ).toBe(true);
  });
});

describe("sanitizeViewQuery", () => {
  it("round-trips a well-formed query blob", () => {
    const want = sanitizeViewQuery(viewQueryFromSnapshot(SLICE));
    expect(want).toMatchObject({
      statusFilters: ["todo", "in_progress"],
      priorityFilters: ["high"],
      includeNoAssignee: true,
      labelFilters: ["label-1"],
    });
  });

  it("keeps a cancelled status filter (a first-class status, not an unknown)", () => {
    const want = sanitizeViewQuery({ statusFilters: ["cancelled", "todo"] });
    expect(want.statusFilters).toEqual(["cancelled", "todo"]);
  });

  it("drops unknown enum members (newer server / hand-edited blob)", () => {
    const want = sanitizeViewQuery({
      statusFilters: ["todo", "shipped", "done"],
      priorityFilters: ["high", "critical"],
      assigneeFilters: [{ type: "agent", id: "a1" }, { id: "no-type" }],
      includeNoAssignee: true,
      creatorFilters: "not-an-array",
      projectFilters: [],
      includeNoProject: false,
      labelFilters: [7],
      propertyFilters: { "prop-1": ["opt-1", ""] },
    });
    expect(want.statusFilters).toEqual(["todo", "done"]);
    expect(want.priorityFilters).toEqual(["high"]);
    expect(want.assigneeFilters).toEqual([{ type: "agent", id: "a1" }]);
    expect(want.creatorFilters).toEqual([]);
    expect(want.labelFilters).toEqual([]);
    expect(want.propertyFilters).toEqual({ "prop-1": ["opt-1"] });
  });

  it("falls back to defaults for a malformed blob", () => {
    const want = sanitizeViewQuery({ hello: "world" });
    expect(want).toEqual({
      statusFilters: [],
      priorityFilters: [],
      assigneeFilters: [],
      includeNoAssignee: false,
      creatorFilters: [],
      projectFilters: [],
      includeNoProject: false,
      labelFilters: [],
      propertyFilters: {},
    });
  });
});

describe("sanitizeViewDisplay", () => {
  it("passes known values through and defaults garbage", () => {
    expect(
      sanitizeViewDisplay({ viewMode: "board", grouping: "assignee" }, "position"),
    ).toEqual({ viewMode: "board", grouping: "assignee", sortBy: "position", sortDirection: "asc", showSubIssues: true });
    expect(
      sanitizeViewDisplay({ viewMode: "calendar", grouping: "nope", sortBy: "weird", sortDirection: "sideways" }, "created_at"),
    ).toEqual({ viewMode: "list", grouping: "status", sortBy: "created_at", sortDirection: "asc", showSubIssues: true });
    // "gantt" is a valid mobile mode since iter-118 — passes through.
    expect(
      sanitizeViewDisplay({ viewMode: "gantt" }, "created_at"),
    ).toEqual({ viewMode: "gantt", grouping: "status", sortBy: "created_at", sortDirection: "asc", showSubIssues: true });
    // "swimlane" is a valid mobile mode since iter-122 — passes through.
    expect(
      sanitizeViewDisplay({ viewMode: "swimlane" }, "created_at"),
    ).toEqual({ viewMode: "swimlane", grouping: "status", sortBy: "created_at", sortDirection: "asc", showSubIssues: true });
    expect(sanitizeViewDisplay({}, "due_date")).toEqual({
      viewMode: "list",
      grouping: "status",
      sortBy: "due_date",
      sortDirection: "asc",
      showSubIssues: true,
    });
  });

  it("only an explicit false hides sub-issues (web default is true)", () => {
    expect(sanitizeViewDisplay({ showSubIssues: false }, "position").showSubIssues).toBe(false);
    expect(sanitizeViewDisplay({ showSubIssues: true }, "position").showSubIssues).toBe(true);
    // A view saved before the key existed keeps sub-issues visible.
    expect(sanitizeViewDisplay({}, "position").showSubIssues).toBe(true);
    // Non-boolean garbage falls back to the default rather than hiding.
    expect(sanitizeViewDisplay({ showSubIssues: "no" }, "position").showSubIssues).toBe(true);
  });
});

describe("viewMatchesSlice", () => {
  const VIEW = {
    query: viewQueryFromSnapshot(SLICE),
    display: viewDisplayFromState({
      view: "board" as IssueViewMode,
      grouping: "assignee",
      sortBy: "priority",
      sortDirection: "desc",
      showSubIssues: false,
    }),
  };

  it("true when the slice equals the view snapshot", () => {
    expect(viewMatchesSlice(VIEW, SLICE, "board")).toBe(true);
  });

  it("true even with a user-layer date filter on top (date is not part of a view)", () => {
    expect(
      viewMatchesSlice(
        VIEW,
        { ...SLICE, dateFilter: { field: "created_at", from: "2026-08-01", to: "2026-08-18" } } as unknown as IssueFilterSlice,
        "board",
      ),
    ).toBe(true);
  });

  it("false when a filter dim diverges", () => {
    expect(viewMatchesSlice(VIEW, { ...SLICE, statusFilters: ["todo"] }, "board")).toBe(false);
    expect(viewMatchesSlice(VIEW, { ...SLICE, propertyFilters: {} }, "board")).toBe(false);
  });

  it("false when sort/grouping/viewMode diverge", () => {
    expect(viewMatchesSlice(VIEW, SLICE, "list")).toBe(false);
    expect(viewMatchesSlice(VIEW, { ...SLICE, sortBy: "created_at" }, "board")).toBe(false);
    expect(viewMatchesSlice(VIEW, { ...SLICE, grouping: "status" }, "board")).toBe(false);
  });

  it("false when the show-sub-issues preference diverges", () => {
    expect(viewMatchesSlice(VIEW, { ...SLICE, showSubIssues: true }, "board")).toBe(false);
  });

  it("treats a legacy view with no showSubIssues key as 'sub-issues visible'", () => {
    const legacyView = {
      query: VIEW.query,
      display: { viewMode: "board", grouping: "assignee", sortBy: "priority", sortDirection: "desc" },
    };
    expect(viewMatchesSlice(legacyView, { ...SLICE, showSubIssues: true }, "board")).toBe(true);
    expect(viewMatchesSlice(legacyView, { ...SLICE, showSubIssues: false }, "board")).toBe(false);
  });

  it("treats a view saved on web (verbatim query/display shape) as matching", () => {
    const webView = {
      query: {
        statusFilters: ["todo", "in_progress"],
        priorityFilters: ["high"],
        assigneeFilters: [{ type: "agent", id: "ag-1" }],
        includeNoAssignee: true,
        creatorFilters: [],
        projectFilters: ["prj-1"],
        includeNoProject: false,
        labelFilters: ["label-1"],
        propertyFilters: { "prop-1": ["opt-1", "opt-2"] },
      },
      display: { viewMode: "board", grouping: "assignee", sortBy: "priority", sortDirection: "desc", showSubIssues: false },
    };
    expect(viewMatchesSlice(webView, SLICE, "board")).toBe(true);
  });
});

const VIEW_QUERY = {
  statusFilters: ["todo"],
  priorityFilters: [],
  assigneeFilters: [{ type: "agent", id: "ag-1" }],
  includeNoAssignee: false,
  creatorFilters: [],
  projectFilters: ["prj-1"],
  includeNoProject: false,
  labelFilters: [],
  propertyFilters: { "prop-1": ["opt-1"] },
};

describe("baselineFromViewQuery", () => {
  it("builds has-sets from the sanitized snapshot (unknown members drop)", () => {
    const baseline = baselineFromViewQuery({
      ...VIEW_QUERY,
      statusFilters: ["todo", "not-a-status"],
      assigneeFilters: [{ type: "agent", id: "ag-1" }, { id: "nope" }],
    });
    expect([...baseline.status]).toEqual(["todo"]);
    expect([...baseline.assignee]).toEqual(["agent:ag-1"]);
    expect(baseline.project.has("prj-1")).toBe(true);
    expect([...baseline.property.keys()]).toEqual(["prop-1"]);
    expect(baseline.raw.statusFilters).toEqual(["todo"]);
  });

  it("treats a malformed blob as an empty baseline", () => {
    const baseline = baselineFromViewQuery({ statusFilters: "todo" });
    expect(baseline.raw).toEqual({
      statusFilters: [],
      priorityFilters: [],
      assigneeFilters: [],
      includeNoAssignee: false,
      creatorFilters: [],
      projectFilters: [],
      includeNoProject: false,
      labelFilters: [],
      propertyFilters: {},
    });
    expect(baseline.status.size).toBe(0);
  });
});

describe("issueFilterDelta", () => {
  it("is the live slice verbatim without a baseline (no view open)", () => {
    const delta = issueFilterDelta(SLICE, null);
    expect(delta.statuses).toEqual(["todo", "in_progress"]);
    expect(delta.includeNoAssignee).toBe(true);
    expect(delta.property).toEqual({ "prop-1": ["opt-1", "opt-2"] });
  });

  it("subtracts the view's values, leaving only the user's additions", () => {
    const baseline = baselineFromViewQuery(VIEW_QUERY);
    const delta = issueFilterDelta(
      {
        ...SLICE,
        statusFilters: ["todo", "done"],
        projectFilters: ["prj-1", "prj-2"],
        assigneeFilters: [
          { type: "agent", id: "ag-1" },
          { type: "member", id: "mb-1" },
        ],
      },
      baseline,
    );
    expect(delta.statuses).toEqual(["done"]);
    expect(delta.projects).toEqual(["prj-2"]);
    expect(delta.assignees).toEqual([{ type: "member", id: "mb-1" }]);
  });

  it("keeps a property option the view does not fix", () => {
    const baseline = baselineFromViewQuery(VIEW_QUERY);
    const delta = issueFilterDelta(
      { ...SLICE, propertyFilters: { "prop-1": ["opt-1", "opt-2"], "prop-2": ["x"] } },
      baseline,
    );
    expect(delta.property).toEqual({ "prop-1": ["opt-2"], "prop-2": ["x"] });
  });

  it("hides a paired flag the view already sets", () => {
    const baseline = baselineFromViewQuery({ ...VIEW_QUERY, includeNoAssignee: true });
    expect(issueFilterDelta({ ...SLICE, includeNoAssignee: true }, baseline).includeNoAssignee).toBe(false);
    // …but the user turning it OFF is a delta in the other direction: no
    // chip, just the view's "modified" dot (same as web).
    expect(issueFilterDelta({ ...SLICE, includeNoAssignee: false }, baseline).includeNoAssignee).toBe(false);
  });
});

describe("clearDimensionToBaseline", () => {
  const baseline = baselineFromViewQuery(VIEW_QUERY);

  it("returns a dimension to the view's values, never to empty", () => {
    const next = clearDimensionToBaseline(
      { ...SLICE, statusFilters: ["todo", "done"] },
      "status",
      baseline,
    );
    expect(next.statusFilters).toEqual(["todo"]);
    expect(next.priorityFilters).toEqual(["high"]);
  });

  it("carries the paired flag with its dimension", () => {
    const withAssignee = baselineFromViewQuery({ ...VIEW_QUERY, includeNoAssignee: true });
    const next = clearDimensionToBaseline(
      { ...SLICE, assigneeFilters: [], includeNoAssignee: false },
      "assignee",
      withAssignee,
    );
    expect(next.assigneeFilters).toEqual([{ type: "agent", id: "ag-1" }]);
    expect(next.includeNoAssignee).toBe(true);
  });

  it("restores a fixed property definition and drops one the view never fixed", () => {
    const restored = clearDimensionToBaseline(
      { ...SLICE, propertyFilters: { "prop-1": ["opt-1", "opt-2"], "prop-2": ["x"] } },
      "property:prop-1",
      baseline,
    );
    expect(restored.propertyFilters).toEqual({
      "prop-1": ["opt-1"],
      "prop-2": ["x"],
    });

    const dropped = clearDimensionToBaseline(
      { ...SLICE, propertyFilters: { "prop-2": ["x"] } },
      "property:prop-2",
      baseline,
    );
    expect(dropped.propertyFilters).toEqual({});
  });

  it("leaves the date window alone (a user layer no view carries)", () => {
    const next = clearDimensionToBaseline(SLICE, "label", baseline);
    expect(next).not.toHaveProperty("dateFilter");
  });
});
