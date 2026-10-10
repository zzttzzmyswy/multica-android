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

/** Web's default for all eight card properties (view-store.ts:287-296). */
const ALL_CARD_PROPERTIES_ON = {
  priority: true,
  description: true,
  assignee: true,
  startDate: true,
  dueDate: true,
  project: true,
  childProgress: true,
  labels: true,
};

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
  tableHierarchy: true,
  cardProperties: { ...ALL_CARD_PROPERTIES_ON },
  // The store default (web view-store.ts:297). Non-empty arrays are passed
  // explicitly by the cases that need them, so this stays the shape a
  // pre-key view restores to and the legacy-view cases below keep their
  // meaning.
  cardPropertyIds: [],
  toggleStatusFilter: () => {},
  hideStatus: () => {},
  showStatus: () => {},
  togglePriorityFilter: () => {},
  toggleAssigneeFilter: () => {},
  toggleNoAssignee: () => {},
  toggleCreatorFilter: () => {},
  toggleProjectFilter: () => {},
  toggleNoProject: () => {},
  toggleLabelFilter: () => {},
  togglePropertyFilter: () => {},
  setPropertyFilterValues: () => {},
  clearPropertyFilter: () => {},
  setDateFilter: () => {},
  toggleWorkingOnly: () => {},
  toggleShowSubIssues: () => {},
  toggleTableHierarchy: () => {},
  toggleCardProperty: () => {},
  toggleCardPropertyId: () => {},
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
  it("serializes viewMode/grouping/sortBy/sortDirection/showSubIssues/tableHierarchy + cardProperties", () => {
    expect(
      viewDisplayFromState({
        view: "board",
        grouping: "assignee",
        sortBy: "priority",
        sortDirection: "desc",
        showSubIssues: false,
        tableHierarchy: true,cardProperties: SLICE.cardProperties,

        cardPropertyIds: SLICE.cardPropertyIds,
      }),
    ).toEqual({
      viewMode: "board",
      grouping: "assignee",
      sortBy: "priority",
      sortDirection: "desc",
      showSubIssues: false,
      tableHierarchy: true,cardProperties: SLICE.cardProperties,

      cardPropertyIds: SLICE.cardPropertyIds,
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
        tableHierarchy: true,cardProperties: SLICE.cardProperties,

        cardPropertyIds: SLICE.cardPropertyIds,
      }).showSubIssues,
    ).toBe(true);
  });

  it("writes all eight card-property keys, so a web view survives a mobile resave", () => {
    // The three keys mobile gates nothing with (description / project /
    // childProgress) still have to be WRITTEN, or a web-saved view would lose
    // them the moment mobile re-saved it.
    const display = viewDisplayFromState({
      view: "board",
      grouping: "status",
      sortBy: "position",
      sortDirection: "asc",
      showSubIssues: true,
      tableHierarchy: true,cardProperties: SLICE.cardProperties,

      cardPropertyIds: SLICE.cardPropertyIds,
    });
    expect(Object.keys(display.cardProperties as object).sort()).toEqual([
      "assignee",
      "childProgress",
      "description",
      "dueDate",
      "labels",
      "priority",
      "project",
      "startDate",
    ]);
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
    ).toEqual({ viewMode: "board", grouping: "assignee", sortBy: "position", sortDirection: "asc", showSubIssues: true, tableHierarchy: true, cardProperties: ALL_CARD_PROPERTIES_ON, cardPropertyIds: [] });
    expect(
      sanitizeViewDisplay({ viewMode: "calendar", grouping: "nope", sortBy: "weird", sortDirection: "sideways" }, "created_at"),
    ).toEqual({ viewMode: "list", grouping: "status", sortBy: "created_at", sortDirection: "asc", showSubIssues: true, tableHierarchy: true, cardProperties: ALL_CARD_PROPERTIES_ON, cardPropertyIds: [] });
    // "gantt" is a valid mobile mode since iter-118 — passes through.
    expect(
      sanitizeViewDisplay({ viewMode: "gantt" }, "created_at"),
    ).toEqual({ viewMode: "gantt", grouping: "status", sortBy: "created_at", sortDirection: "asc", showSubIssues: true, tableHierarchy: true, cardProperties: ALL_CARD_PROPERTIES_ON, cardPropertyIds: [] });
    // "swimlane" is a valid mobile mode since iter-122 — passes through.
    expect(
      sanitizeViewDisplay({ viewMode: "swimlane" }, "created_at"),
    ).toEqual({ viewMode: "swimlane", grouping: "status", sortBy: "created_at", sortDirection: "asc", showSubIssues: true, tableHierarchy: true, cardProperties: ALL_CARD_PROPERTIES_ON, cardPropertyIds: [] });
    expect(sanitizeViewDisplay({}, "due_date")).toEqual({
      viewMode: "list",
      grouping: "status",
      sortBy: "due_date",
      sortDirection: "asc",
      showSubIssues: true,
      tableHierarchy: true,
      cardProperties: ALL_CARD_PROPERTIES_ON,
      cardPropertyIds: [],
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

  it("only an explicit false flattens the table (web default is nested)", () => {
    // Same rule as showSubIssues above, and for the same reason: a view saved
    // before the key existed must not read as "flat".
    expect(sanitizeViewDisplay({ tableHierarchy: false }, "position").tableHierarchy).toBe(false);
    expect(sanitizeViewDisplay({ tableHierarchy: true }, "position").tableHierarchy).toBe(true);
    expect(sanitizeViewDisplay({}, "position").tableHierarchy).toBe(true);
    expect(sanitizeViewDisplay({ tableHierarchy: "no" }, "position").tableHierarchy).toBe(true);
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
      tableHierarchy: true,cardProperties: SLICE.cardProperties,

      cardPropertyIds: SLICE.cardPropertyIds,
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

  it("false when the table hierarchy preference diverges", () => {
    // `tableHierarchy` is part of what a saved view fixes (web writes it into
    // the display payload at save-view-dialog.tsx:608), so flipping the switch
    // must light the "modified" dot — otherwise the change would be silently
    // unsavable.
    expect(viewMatchesSlice(VIEW, { ...SLICE, tableHierarchy: false }, "board")).toBe(false);
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

// ---------------------------------------------------------------------------
// cardProperties round-trip (iteration 181, MYS-1564 / G28).
//
// The codec's contract is round-trip fidelity: a view saved on web must be
// readable here, and a mobile open-and-resave must not drop the keys mobile
// has no content for. These cases pin both directions.
// ---------------------------------------------------------------------------
describe("cardProperties round-trip", () => {
  it("restores an explicit false, not the all-on default", () => {
    const off = { ...ALL_CARD_PROPERTIES_ON, priority: false, labels: false };
    expect(sanitizeViewDisplay({ cardProperties: off }, "position").cardProperties).toEqual(off);
  });

  it("defaults every key to true for a view with no cardProperties at all", () => {
    expect(sanitizeViewDisplay({}, "position").cardProperties).toEqual(ALL_CARD_PROPERTIES_ON);
  });

  it("defaults only the MISSING keys, keeping the ones the view carries", () => {
    // A view saved before `project` existed: the three keys it carries survive
    // and the rest read as on.
    expect(
      sanitizeViewDisplay(
        { cardProperties: { priority: false, labels: true } },
        "position",
      ).cardProperties,
    ).toEqual({ ...ALL_CARD_PROPERTIES_ON, priority: false, labels: true });
  });

  it("ignores non-boolean garbage per key rather than hiding the field", () => {
    expect(
      sanitizeViewDisplay(
        {
          cardProperties: {
            priority: "no",
            labels: 0,
            dueDate: null,
            assignee: false,
          },
        },
        "position",
      ).cardProperties,
    ).toEqual({
      ...ALL_CARD_PROPERTIES_ON,
      // Only the real boolean false turns a field off.
      assignee: false,
    });
  });

  it("survives a non-object cardProperties blob", () => {
    for (const garbage of ["nope", 42, null, undefined, ["priority"]]) {
      expect(
        sanitizeViewDisplay({ cardProperties: garbage }, "position").cardProperties,
      ).toEqual(ALL_CARD_PROPERTIES_ON);
    }
  });

  it("is lossless: serialize then read back yields the same eight keys", () => {
    const original = { ...ALL_CARD_PROPERTIES_ON, description: false, childProgress: false };
    const display = viewDisplayFromState({
      view: "board",
      grouping: "status",
      sortBy: "position",
      sortDirection: "asc",
      showSubIssues: true,
      tableHierarchy: true,
      cardProperties: original,
      cardPropertyIds: SLICE.cardPropertyIds,
    });
    expect(sanitizeViewDisplay(display, "position").cardProperties).toEqual(original);
  });

  it("lights the modified dot when a card property is toggled", () => {
    // The whole reason `viewMatchesSlice` has to compare cardProperties: flip
    // one and the active view is no longer what the user is looking at.
    const view = {
      query: viewQueryFromSnapshot(SLICE),
      display: viewDisplayFromState({
        view: "board" as IssueViewMode,
        grouping: "assignee",
        sortBy: "priority",
        sortDirection: "desc",
        showSubIssues: false,
        tableHierarchy: true,cardProperties: SLICE.cardProperties,

        cardPropertyIds: SLICE.cardPropertyIds,
      }),
    };
    expect(viewMatchesSlice(view, SLICE, "board")).toBe(true);
    expect(
      viewMatchesSlice(
        view,
        { ...SLICE, cardProperties: { ...SLICE.cardProperties, priority: false } },
        "board",
      ),
    ).toBe(false);
    // ...and a view that never carried the key matches an all-on slice, so a
    // pre-cardProperties view does not read as permanently modified.
    const legacy = {
      query: view.query,
      display: {
        viewMode: "board",
        grouping: "assignee",
        sortBy: "priority",
        sortDirection: "desc",
        showSubIssues: false,
      },
    };
    // A legacy view (saved before the key existed) also has to match on
    // tableHierarchy, or every pre-toggle view would read as modified.
    expect(viewMatchesSlice(legacy, SLICE, "board")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cardPropertyIds round-trip (iteration 189, MYS-1866).
//
// The second card display dimension. Same round-trip contract as
// cardProperties above, plus one deliberate difference: unlike every other
// sanitizer here, unknown ids are KEPT (a definition absent from the CURRENT
// catalog is not necessarily deleted — see sanitizeCardPropertyIds).
// ---------------------------------------------------------------------------
describe("cardPropertyIds round-trip", () => {
  it("serializes the ids verbatim, order included", () => {
    const display = viewDisplayFromState({
      view: "board",
      grouping: "status",
      sortBy: "position",
      sortDirection: "asc",
      showSubIssues: true,
      tableHierarchy: true,
      cardProperties: SLICE.cardProperties,
      cardPropertyIds: ["prop-b", "prop-a"],
    });
    // Order is the render order, so it must not be sorted or deduped.
    expect(display.cardPropertyIds).toEqual(["prop-b", "prop-a"]);
    expect(sanitizeViewDisplay(display, "position").cardPropertyIds).toEqual([
      "prop-b",
      "prop-a",
    ]);
  });

  it("defaults to an empty list for a view saved before the key existed", () => {
    expect(sanitizeViewDisplay({}, "position").cardPropertyIds).toEqual([]);
  });

  it("KEEPS an unknown id rather than dropping it", () => {
    // The deliberate divergence from the other sanitizers: the catalog is a
    // separate query, so an id with no definition *right now* may still be
    // resolvable later. Dropping would permanently lose a web view's chip.
    expect(
      sanitizeViewDisplay({ cardPropertyIds: ["ghost"] }, "position")
        .cardPropertyIds,
    ).toEqual(["ghost"]);
  });

  it("drops only non-string members and empty strings", () => {
    expect(
      sanitizeViewDisplay(
        { cardPropertyIds: ["ok", 42, null, "", { id: "x" }, "fine"] },
        "position",
      ).cardPropertyIds,
    ).toEqual(["ok", "fine"]);
  });

  it("survives a non-array blob", () => {
    for (const garbage of ["nope", 42, null, undefined, { a: 1 }]) {
      expect(
        sanitizeViewDisplay({ cardPropertyIds: garbage }, "position")
          .cardPropertyIds,
      ).toEqual([]);
    }
  });

  it("lights the modified dot when a custom property is added or removed", () => {
    const view = {
      query: viewQueryFromSnapshot(SLICE),
      display: viewDisplayFromState({
        view: "board" as IssueViewMode,
        grouping: "assignee",
        sortBy: "priority",
        sortDirection: "desc",
        showSubIssues: false,
        tableHierarchy: true,
        cardProperties: SLICE.cardProperties,
        cardPropertyIds: SLICE.cardPropertyIds,
      }),
    };
    expect(viewMatchesSlice(view, SLICE, "board")).toBe(true);
    expect(
      viewMatchesSlice(
        view,
        { ...SLICE, cardPropertyIds: [...SLICE.cardPropertyIds, "prop-new"] },
        "board",
      ),
    ).toBe(false);
  });

  it("treats a reorder as a modification, because order is the render order", () => {
    // `sameStrings` compares positionally — deliberate here, unlike the
    // order-independent cardProperties comparison. Two ids are needed for a
    // reorder to be observable at all.
    const ids = ["prop-a", "prop-b"];
    const reversed = [...ids].reverse();
    expect(reversed).not.toEqual(ids);
    const slice = { ...SLICE, cardPropertyIds: ids };
    const view = {
      query: viewQueryFromSnapshot(slice),
      display: viewDisplayFromState({
        view: "board" as IssueViewMode,
        grouping: "assignee",
        sortBy: "priority",
        sortDirection: "desc",
        showSubIssues: false,
        tableHierarchy: true,
        cardProperties: SLICE.cardProperties,
        cardPropertyIds: reversed,
      }),
    };
    expect(viewMatchesSlice(view, slice, "board")).toBe(false);
    // Same two ids in the same order DO match — the clause compares position,
    // not just membership.
    const sameOrder = {
      query: view.query,
      display: viewDisplayFromState({
        view: "board" as IssueViewMode,
        grouping: "assignee",
        sortBy: "priority",
        sortDirection: "desc",
        showSubIssues: false,
        tableHierarchy: true,
        cardProperties: SLICE.cardProperties,
        cardPropertyIds: ids,
      }),
    };
    expect(viewMatchesSlice(sameOrder, slice, "board")).toBe(true);
  });

  it("does not read a pre-cardPropertyIds view as permanently modified", () => {
    // A view saved before this key existed carries no ids; the slice default
    // is also empty, so the two agree and the dot stays dark.
    const legacy = {
      query: viewQueryFromSnapshot(SLICE),
      display: {
        viewMode: "board",
        grouping: "assignee",
        sortBy: "priority",
        sortDirection: "desc",
        showSubIssues: false,
        cardProperties: SLICE.cardProperties,
      },
    };
    expect(
      viewMatchesSlice(legacy, { ...SLICE, cardPropertyIds: [] }, "board"),
    ).toBe(true);
  });
});
