/**
 * Table grouping for the mobile issue table (MYS-1156). Web groups on the
 * server (rows are paginated per (groupKey, parentId) branch); mobile derives
 * both the group key and the per-segment hierarchy. The interesting cases are
 * therefore the ones the server used to guarantee: segment order, the
 * unassigned / unset / unavailable buckets, and a sub-issue whose parent is in
 * a different segment.
 */
import { describe, expect, it } from "vitest";
import type { Issue, IssueProperty } from "@multica/core/types";
import {
  buildIssueTableDisplayRows,
  buildIssueTableGroups,
  isGroupableProperty,
  propertyIdFromGrouping,
} from "./issue-table-groups";

function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: "i",
    identifier: "MYS-1",
    title: "issue",
    status: "todo",
    priority: "medium",
    assignee_type: null,
    assignee_id: null,
    parent_issue_id: null,
    properties: {},
    ...over,
  } as Issue;
}

function selectProperty(
  id: string,
  options: { id: string; name: string }[],
): IssueProperty {
  return {
    id,
    name: id,
    type: "select",
    config: { options: options.map((o) => ({ ...o, color: "#000" })) },
    position: 0,
    archived: false,
  } as IssueProperty;
}

function checkboxProperty(id: string): IssueProperty {
  return {
    id,
    name: id,
    type: "checkbox",
    config: {},
    position: 0,
    archived: false,
  } as IssueProperty;
}

/** Compact view of the segmentation: "key(count):id@depth[*-]". */
function shape(
  issues: Issue[],
  grouping: Parameters<typeof buildIssueTableGroups>[1],
  properties: IssueProperty[] = [],
  collapsed: string[] = [],
  actorName?: (a: { type: string; id: string }) => string,
): string[] {
  return buildIssueTableGroups(
    issues,
    grouping,
    properties,
    new Set(collapsed),
    { actorName },
  ).map(
    (g) =>
      `${g.key}(${g.count}):${g.rows
        .map(
          (r) =>
            `${r.issue.id}@${r.depth}${r.hasChildren ? "*" : ""}${r.collapsed ? "-" : ""}`,
        )
        .join(",")}`,
  );
}

describe("propertyIdFromGrouping / isGroupableProperty", () => {
  it("reads the definition id out of a property grouping key", () => {
    expect(propertyIdFromGrouping("property:p1")).toBe("p1");
    expect(propertyIdFromGrouping("status")).toBeNull();
    expect(propertyIdFromGrouping("assignee")).toBeNull();
  });

  it("only select and checkbox definitions are groupable (web parity)", () => {
    expect(isGroupableProperty(selectProperty("p", []))).toBe(true);
    expect(isGroupableProperty(checkboxProperty("p"))).toBe(true);
    expect(
      isGroupableProperty({ type: "text", config: {} } as IssueProperty),
    ).toBe(false);
    expect(
      isGroupableProperty({ type: "multi_select", config: {} } as IssueProperty),
    ).toBe(false);
  });
});

describe("buildIssueTableGroups — none", () => {
  it("returns the flat rows as one unnamed segment", () => {
    const rows = shape(
      [issue({ id: "a" }), issue({ id: "b", parent_issue_id: "a" })],
      "none",
    );
    expect(rows).toEqual(["all(2):a@0*,b@1"]);
  });
});

describe("buildIssueTableGroups — status", () => {
  it("orders segments by the canonical status order, not by first appearance", () => {
    const issues = [
      issue({ id: "done", status: "done" }),
      issue({ id: "backlog", status: "backlog" }),
      issue({ id: "review", status: "in_review" }),
    ];
    expect(shape(issues, "status")).toEqual([
      "status:backlog(1):backlog@0",
      "status:in_review(1):review@0",
      "status:done(1):done@0",
    ]);
  });

  it("keeps rows inside a segment in the window's own (user-sorted) order", () => {
    const issues = [
      issue({ id: "b", status: "todo" }),
      issue({ id: "a", status: "todo" }),
    ];
    expect(shape(issues, "status")).toEqual(["status:todo(2):b@0,a@0"]);
  });

  it("sorts a status the client doesn't know last instead of dropping it", () => {
    const issues = [
      issue({ id: "new", status: "brand_new" }),
      issue({ id: "todo", status: "todo" }),
    ];
    expect(shape(issues, "status")).toEqual([
      "status:todo(1):todo@0",
      "status:brand_new(1):new@0",
    ]);
  });
});

describe("buildIssueTableGroups — assignee", () => {
  it("orders member < agent < squad, then by display name", () => {
    const issues = [
      issue({ id: "s", assignee_type: "squad", assignee_id: "s1" }),
      issue({ id: "b", assignee_type: "agent", assignee_id: "a2" }),
      issue({ id: "a", assignee_type: "agent", assignee_id: "a1" }),
      issue({ id: "m", assignee_type: "member", assignee_id: "u1" }),
    ];
    const names: Record<string, string> = { a1: "Zed", a2: "Ada", u1: "Mia", s1: "Sq" };
    expect(
      shape(issues, "assignee", [], [], (actor) => names[actor.id] ?? ""),
    ).toEqual([
      "assignee:member:u1(1):m@0",
      "assignee:agent:a2(1):b@0",
      "assignee:agent:a1(1):a@0",
      "assignee:squad:s1(1):s@0",
    ]);
  });

  it("puts the unassigned bucket last", () => {
    const issues = [
      issue({ id: "none" }),
      issue({ id: "m", assignee_type: "member", assignee_id: "u1" }),
    ];
    expect(shape(issues, "assignee")).toEqual([
      "assignee:member:u1(1):m@0",
      "assignee:unassigned(1):none@0",
    ]);
  });
});

describe("buildIssueTableGroups — select property", () => {
  const prop = selectProperty("p1", [
    { id: "o2", name: "Second" },
    { id: "o1", name: "First" },
  ]);

  it("orders value buckets by the definition's option order, then unavailable, then unset", () => {
    const issues = [
      issue({ id: "unset" }),
      issue({ id: "unavailable", properties: { p1: "ghost" } }),
      issue({ id: "second", properties: { p1: "o2" } }),
      issue({ id: "first", properties: { p1: "o1" } }),
    ];
    expect(shape(issues, "property:p1", [prop])).toEqual([
      "property:p1:value:o2(1):second@0",
      "property:p1:value:o1(1):first@0",
      "property:p1:unavailable:ghost(1):unavailable@0",
      "property:p1:unset(1):unset@0",
    ]);
  });

  it("collapses the whole window into one unavailable bucket when the definition is gone", () => {
    const issues = [
      issue({ id: "a", properties: { p1: "o1" } }),
      issue({ id: "b" }),
    ];
    expect(shape(issues, "property:p1", [])).toEqual([
      "property:p1:unavailable(2):a@0,b@0",
    ]);
  });

  it("drops the stale suffix for a non-string value, matching the server's bucket", () => {
    const issues = [issue({ id: "odd", properties: { p1: 7 as never } })];
    expect(shape(issues, "property:p1", [prop])).toEqual([
      "property:p1:unavailable(1):odd@0",
    ]);
  });
});

describe("buildIssueTableGroups — checkbox property", () => {
  const prop = checkboxProperty("p1");

  it("orders false, true, then unknown values", () => {
    const issues = [
      issue({ id: "weird", properties: { p1: "yes" } }),
      issue({ id: "on", properties: { p1: true } }),
      issue({ id: "off", properties: { p1: false } }),
    ];
    expect(shape(issues, "property:p1", [prop])).toEqual([
      "property:p1:value:false(1):off@0",
      "property:p1:value:true(1):on@0",
      "property:p1:unavailable(1):weird@0",
    ]);
  });
});

describe("buildIssueTableGroups — hierarchy is per segment", () => {
  it("indents a child whose parent is in the same segment", () => {
    const issues = [
      issue({ id: "parent", status: "todo" }),
      issue({ id: "child", status: "todo", parent_issue_id: "parent" }),
    ];
    expect(shape(issues, "status")).toEqual([
      "status:todo(2):parent@0*,child@1",
    ]);
  });

  it("reads a child whose parent is in ANOTHER segment as a root there", () => {
    const issues = [
      issue({ id: "parent", status: "in_progress" }),
      issue({ id: "child", status: "todo", parent_issue_id: "parent" }),
    ];
    // Web's branch fetch has the same result: the todo branch starts at
    // parentId=null, so the child is that branch's root.
    expect(shape(issues, "status")).toEqual([
      "status:todo(1):child@0",
      "status:in_progress(1):parent@0",
    ]);
  });

  it("prunes a collapsed parent's subtree inside its own segment only", () => {
    const issues = [
      issue({ id: "parent", status: "todo" }),
      issue({ id: "child", status: "todo", parent_issue_id: "parent" }),
      issue({ id: "other", status: "done" }),
    ];
    expect(shape(issues, "status", [], ["parent"])).toEqual([
      "status:todo(2):parent@0*-",
      "status:done(1):other@0",
    ]);
  });

  it("counts the whole segment even when a subtree is collapsed away", () => {
    const issues = [
      issue({ id: "parent", status: "todo" }),
      issue({ id: "child", status: "todo", parent_issue_id: "parent" }),
    ];
    expect(shape(issues, "status", [], ["parent"])).toEqual([
      "status:todo(2):parent@0*-",
    ]);
  });
});

describe("buildIssueTableDisplayRows", () => {
  const issues = [
    issue({ id: "p", status: "todo" }),
    issue({ id: "c", status: "todo", parent_issue_id: "p" }),
    issue({ id: "d", status: "done" }),
  ];

  it("interleaves group headers with their rows", () => {
    const rows = buildIssueTableDisplayRows(
      issues,
      "status",
      [],
      new Set(),
      new Set(),
    );
    expect(
      rows.map((r) => (r.kind === "group" ? `#${r.key}(${r.count})` : r.row.issue.id)),
    ).toEqual(["#status:todo(2)", "p", "c", "#status:done(1)", "d"]);
  });

  it("hides a collapsed group's rows but keeps its header and count", () => {
    const rows = buildIssueTableDisplayRows(
      issues,
      "status",
      [],
      new Set(),
      new Set(["status:todo"]),
    );
    expect(
      rows.map((r) =>
        r.kind === "group"
          ? `#${r.key}(${r.count})${r.collapsed ? "-" : ""}`
          : r.row.issue.id,
      ),
    ).toEqual(["#status:todo(2)-", "#status:done(1)", "d"]);
  });

  it("group collapse and parent collapse are independent states", () => {
    // Collapsing the parent hides "c" but leaves the segment expanded;
    // collapsing the segment hides both rows without touching the parent's
    // own collapsed set.
    const parentCollapsed = buildIssueTableDisplayRows(
      issues,
      "status",
      [],
      new Set(["p"]),
      new Set(),
    );
    expect(
      parentCollapsed.map((r) => (r.kind === "group" ? `#${r.key}` : r.row.issue.id)),
    ).toEqual(["#status:todo", "p", "#status:done", "d"]);

    const groupCollapsed = buildIssueTableDisplayRows(
      issues,
      "status",
      [],
      new Set(),
      new Set(["status:todo"]),
    );
    expect(
      groupCollapsed.map((r) => (r.kind === "group" ? `#${r.key}` : r.row.issue.id)),
    ).toEqual(["#status:todo", "#status:done", "d"]);
  });

  it("emits no header at all when grouping is off", () => {
    const rows = buildIssueTableDisplayRows(
      issues,
      "none",
      [],
      new Set(),
      new Set(),
    );
    expect(rows.every((r) => r.kind === "row")).toBe(true);
    expect(rows).toHaveLength(3);
  });
});
