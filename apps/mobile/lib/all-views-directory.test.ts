import { describe, expect, it } from "vitest";
import {
  ALL_VIEWS_SCOPES,
  buildAllViewsRows,
  countAdvancedConditions,
  countViewFilters,
  directoryScopeCounts,
  filterDirectoryRows,
  locationOf,
  viewInDirectoryScope,
  type DirectoryScope,
} from "./all-views-directory";
import type { IssueView } from "@multica/core/api/schemas";

function view(over: Partial<IssueView> & { id: string }): IssueView {
  return {
    workspace_id: "ws-1",
    owner_id: "u-me",
    name: over.id,
    scope_type: "workspace",
    scope_id: null,
    scope_variant: null,
    visibility: "private",
    definition_version: 1,
    query: {},
    display: {},
    revision: 1,
    created_at: "",
    updated_at: "",
    ...over,
  } as IssueView;
}

// The directory page (web `packages/views/issue-views/all-views-page.tsx`)
// lists every view the caller can open, across workspace / my / project
// scopes, and classifies each row four ways. Mobile had no equivalent, and
// no cross-scope list at all — these assertions pin the classification and
// counting rules that page renders.
describe("viewInDirectoryScope", () => {
  it("puts a view I own in mine, even when it is also shared", () => {
    const row = view({ id: "v1", owner_id: "u-me", visibility: "workspace" });
    expect(viewInDirectoryScope("mine", row, "u-me")).toBe(true);
    // Web's `mine` and `shared` are INDEPENDENT predicates, not a partition —
    // its counts and its row filters each test one field. Keeping them
    // independent is what makes a mobile count equal web's for the same data.
    expect(viewInDirectoryScope("shared", row, "u-me")).toBe(true);
  });

  it("puts someone else's shared view in shared but not mine", () => {
    const row = view({ id: "v1", owner_id: "u-other", visibility: "workspace" });
    expect(viewInDirectoryScope("shared", row, "u-me")).toBe(true);
    expect(viewInDirectoryScope("mine", row, "u-me")).toBe(false);
  });

  it("puts someone else's private view in neither narrower bucket", () => {
    // Reachable through a project scope the caller belongs to, so it must
    // still render under "all" — it just belongs to no narrower bucket.
    const row = view({ id: "v1", owner_id: "u-other", visibility: "private" });
    expect(viewInDirectoryScope("mine", row, "u-me")).toBe(false);
    expect(viewInDirectoryScope("shared", row, "u-me")).toBe(false);
    expect(viewInDirectoryScope("all", row, "u-me")).toBe(true);
  });

  it("never treats an unknown user id as mine", () => {
    expect(
      viewInDirectoryScope("mine", view({ id: "v1", owner_id: "u-me" }), null),
    ).toBe(false);
  });
});

describe("countViewFilters", () => {
  // Web's `issueViewFilterCount` counts DIMENSIONS, not values: a view
  // filtering three statuses is "1 filter". Mirroring that is what keeps the
  // number on a mobile row equal to the number web shows for the same view.
  it("counts a multi-value dimension as one, like web", () => {
    expect(countViewFilters({ statusFilters: ["todo", "done", "blocked"] })).toBe(1);
  });

  it("counts each non-empty dimension separately", () => {
    expect(
      countViewFilters({
        statusFilters: ["todo"],
        priorityFilters: ["high"],
        labelFilters: ["l1"],
      }),
    ).toBe(3);
  });

  it("counts an empty dimension as nothing", () => {
    expect(countViewFilters({ statusFilters: [], priorityFilters: [] })).toBe(0);
    expect(countViewFilters({})).toBe(0);
  });

  it("counts includeNoAssignee as the assignee dimension", () => {
    expect(countViewFilters({ includeNoAssignee: true })).toBe(1);
    // Two ways of saying "the assignee dimension is constrained" is still one
    // dimension — web ORs them into a single array slot.
    expect(
      countViewFilters({ assigneeFilters: [{ type: "member", id: "u-1" }], includeNoAssignee: true }),
    ).toBe(1);
  });

  it("counts includeNoProject as the project dimension", () => {
    expect(countViewFilters({ includeNoProject: true })).toBe(1);
  });

  it("counts agentRunningFilter and unreadFilter on their own", () => {
    expect(countViewFilters({ agentRunningFilter: true })).toBe(1);
    expect(countViewFilters({ unreadFilter: true })).toBe(1);
    expect(countViewFilters({ agentRunningFilter: true, unreadFilter: true })).toBe(2);
  });

  it("counts dimensions mobile cannot edit but web can, so the numbers agree", () => {
    // These three exist upstream and in this deployment's server; mobile's
    // view store has no field for them. Counting them anyway is the whole
    // point — a row that silently reported 0 for a view web reports as 3
    // would be a lie about the view's contents.
    expect(countViewFilters({ dueDateFilters: ["overdue"] })).toBe(1);
    expect(countViewFilters({ relationFilters: ["blocked_by"] })).toBe(1);
    expect(countViewFilters({ projectStatusFilters: ["active"] })).toBe(1);
  });

  it("does NOT count negatedFilters — web's counter omits it", () => {
    // Recorded as a test rather than left implicit: `negatedFilters` IS a
    // dimension web stores and serializes, but `issueViewFilterCount`
    // (baseline.ts:183-202) does not list it. Adding it here would make
    // mobile's number differ from web's for the same view, which is exactly
    // the drift this page exists to avoid.
    expect(countViewFilters({ negatedFilters: ["label"] })).toBe(0);
  });

  it("counts one per filtered property definition, not per selected option", () => {
    expect(
      countViewFilters({
        propertyFilters: { p1: ["a", "b"], p2: ["c"] },
      }),
    ).toBe(2);
  });

  it("ignores a property definition with no selected options", () => {
    expect(countViewFilters({ propertyFilters: { p1: [] } })).toBe(0);
  });

  it("counts advanced-filter leaf conditions", () => {
    const tree = {
      type: "group",
      id: "root",
      conjunction: "and",
      children: [
        { type: "condition", id: "c1", field: "status", values: ["todo"] },
        {
          type: "group",
          id: "g1",
          conjunction: "or",
          children: [
            { type: "condition", id: "c2", field: "priority", values: ["high"] },
            { type: "condition", id: "c3", field: "label", values: [] },
          ],
        },
      ],
    };
    // c1 + c2 count; c3 has no values. The group itself is not a condition.
    expect(countViewFilters({ advancedFilter: tree })).toBe(2);
  });

  it("ignores junk shapes instead of throwing", () => {
    expect(countViewFilters({ statusFilters: "todo" })).toBe(0);
    expect(countViewFilters({ propertyFilters: "nope" })).toBe(0);
    expect(countViewFilters({ advancedFilter: 42 })).toBe(0);
  });
});

describe("countAdvancedConditions", () => {
  it("returns 0 for a missing or empty tree", () => {
    expect(countAdvancedConditions(null)).toBe(0);
    expect(countAdvancedConditions(undefined)).toBe(0);
    expect(countAdvancedConditions({ type: "group", children: [] })).toBe(0);
  });

  it("recurses into nested groups", () => {
    expect(
      countAdvancedConditions({
        type: "group",
        children: [
          {
            type: "group",
            children: [
              { type: "condition", values: ["a"] },
              { type: "condition", values: ["b"] },
            ],
          },
        ],
      }),
    ).toBe(2);
  });
});

describe("locationOf", () => {
  const titles = new Map([["proj-1", "Apollo"]]);

  it("names the project for a project-scoped view", () => {
    expect(
      locationOf(view({ id: "v", scope_type: "project", scope_id: "proj-1" }), titles, {
        myIssues: "My issues",
        allIssues: "All issues",
        project: "Project",
      }),
    ).toBe("Apollo");
  });

  it("falls back to the generic project label when the project is unreadable", () => {
    // The list can outlive the project (deleted, or filtered out of the read
    // the page has). A blank cell would read as "no location" rather than
    // "some project you cannot see".
    expect(
      locationOf(view({ id: "v", scope_type: "project", scope_id: "gone" }), titles, {
        myIssues: "My issues",
        allIssues: "All issues",
        project: "Project",
      }),
    ).toBe("Project");
  });

  it("labels my and workspace scopes", () => {
    const labels = { myIssues: "My issues", allIssues: "All issues", project: "Project" };
    expect(locationOf(view({ id: "v", scope_type: "my" }), titles, labels)).toBe("My issues");
    expect(locationOf(view({ id: "v", scope_type: "workspace" }), titles, labels)).toBe("All issues");
  });
});

describe("filterDirectoryRows", () => {
  const builtins = [
    { key: "my_issues" as const, name: "My issues", rowId: "builtin:my_issues" },
    { key: "unread" as const, name: "Unread", rowId: "builtin:unread" },
  ];
  const views = [
    view({ id: "v-mine", name: "Zeta", owner_id: "u-me" }),
    view({ id: "v-shared", name: "Alpha", owner_id: "u-other", visibility: "workspace" }),
    view({ id: "v-foreign", name: "Beta", owner_id: "u-other", visibility: "private" }),
  ];

  it("lists builtins then every view under all", () => {
    const rows = filterDirectoryRows("all", builtins, views, "u-me");
    expect(rows.map((r) => r.rowId)).toEqual([
      "builtin:my_issues",
      "builtin:unread",
      "view:v-shared",
      "view:v-foreign",
      "view:v-mine",
    ]);
  });

  it("hides every saved view under builtin", () => {
    expect(filterDirectoryRows("builtin", builtins, views, "u-me").map((r) => r.rowId)).toEqual([
      "builtin:my_issues",
      "builtin:unread",
    ]);
  });

  it("hides the builtins under mine and shared", () => {
    expect(filterDirectoryRows("mine", builtins, views, "u-me").map((r) => r.rowId)).toEqual([
      "view:v-mine",
    ]);
    expect(filterDirectoryRows("shared", builtins, views, "u-me").map((r) => r.rowId)).toEqual([
      "view:v-shared",
    ]);
  });

  it("sorts saved views by name, case-insensitively, the way web does", () => {
    const rows = filterDirectoryRows("all", [], views, "u-me");
    expect(rows.map((r) => r.name)).toEqual(["Alpha", "Beta", "Zeta"]);
  });
});

describe("directoryScopeCounts", () => {
  const views = [
    view({ id: "v-mine", owner_id: "u-me" }),
    view({ id: "v-shared", owner_id: "u-other", visibility: "workspace" }),
    view({ id: "v-foreign", owner_id: "u-other", visibility: "private" }),
  ];

  it("counts each bucket the way its own filter would show", () => {
    const counts = directoryScopeCounts(3, views, "u-me");
    expect(counts.all).toBe(6); // 3 builtins + 3 views
    expect(counts.builtin).toBe(3);
    expect(counts.mine).toBe(1);
    expect(counts.shared).toBe(1);
  });

  it("counts a view I both own and shared in both buckets, like web", () => {
    const counts = directoryScopeCounts(0, [
      view({ id: "v1", owner_id: "u-me", visibility: "workspace" }),
    ], "u-me");
    expect(counts.mine).toBe(1);
    // Web computes `shared` from `visibility` alone (`all-views-page.tsx`
    // counts), so it does not subtract rows already counted as mine.
    expect(counts.shared).toBe(1);
  });
});

describe("buildAllViewsRows", () => {
  it("attaches the resolved view, location and filter count to saved rows", () => {
    const rows = buildAllViewsRows(
      [],
      [view({ id: "v1", name: "Mine", scope_type: "project", scope_id: "p1", query: { statusFilters: ["todo"] } })],
      new Map([["p1", "Apollo"]]),
      { myIssues: "My issues", allIssues: "All issues", project: "Project" },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("view");
    expect(rows[0].name).toBe("Mine");
    expect(rows[0].location).toBe("Apollo");
    expect(rows[0].filterCount).toBe(1);
    expect(rows[0].rowId).toBe("view:v1");
  });

  it("leaves builtin rows without a location or filter count", () => {
    const rows = buildAllViewsRows(
      [{ key: "my_issues", name: "My issues", rowId: "builtin:my_issues" }],
      [],
      new Map(),
      { myIssues: "My issues", allIssues: "All issues", project: "Project" },
    );
    expect(rows[0].kind).toBe("builtin");
    expect(rows[0].location).toBeNull();
    expect(rows[0].filterCount).toBe(0);
  });
});

describe("ALL_VIEWS_SCOPES", () => {
  it("offers the four buckets in web's order", () => {
    expect(ALL_VIEWS_SCOPES satisfies readonly DirectoryScope[]).toEqual([
      "all",
      "builtin",
      "mine",
      "shared",
    ]);
  });
});
