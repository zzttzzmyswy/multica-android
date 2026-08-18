import { describe, expect, it } from "vitest";
import {
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
  sortBy: "priority",
  sortDirection: "desc",
  grouping: "assignee",
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
  it("serializes viewMode/grouping/sortBy/sortDirection only", () => {
    expect(
      viewDisplayFromState({
        view: "board",
        grouping: "assignee",
        sortBy: "priority",
        sortDirection: "desc",
      }),
    ).toEqual({
      viewMode: "board",
      grouping: "assignee",
      sortBy: "priority",
      sortDirection: "desc",
    });
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
    ).toEqual({ viewMode: "board", grouping: "assignee", sortBy: "position", sortDirection: "asc" });
    expect(
      sanitizeViewDisplay({ viewMode: "gantt", grouping: "nope", sortBy: "weird", sortDirection: "sideways" }, "created_at"),
    ).toEqual({ viewMode: "list", grouping: "status", sortBy: "created_at", sortDirection: "asc" });
    expect(sanitizeViewDisplay({}, "due_date")).toEqual({
      viewMode: "list",
      grouping: "status",
      sortBy: "due_date",
      sortDirection: "asc",
    });
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
    }),
  };

  it("true when the slice equals the view snapshot", () => {
    expect(viewMatchesSlice(VIEW, SLICE, "board")).toBe(true);
  });

  it("true even with a user-layer date filter on top (date is not part of a view)", () => {
    expect(
      viewMatchesSlice(VIEW, { ...SLICE, dateFilter: { field: "created_at", from: "2026-08-01", to: "2026-08-18" } }, "board"),
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