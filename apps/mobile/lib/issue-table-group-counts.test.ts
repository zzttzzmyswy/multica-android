/**
 * Tests for the server group-count bridge (MYS-1178). The interesting cases
 * are the property keys: the server base64url-encodes the raw value into its
 * own descriptor key, so the mapping is driven by the descriptor's decoded
 * `value` / `value_state` and has to reproduce the keys
 * `buildIssueTableGroups` builds locally.
 */
import { describe, expect, it } from "vitest";
import type {
  IssueTableGroupDescriptor,
  IssueTableGroupValue,
} from "@multica/core/types";
import {
  buildIssueTableGroupQuerySpec,
  issueTableGroupSpecFor,
  myIssueTableScope,
  serverGroupCountMap,
  serverGroupKey,
  workspaceIssueTableScope,
} from "./issue-table-group-counts";

describe("issueTableGroupSpecFor", () => {
  it("maps each local dimension onto the server's group spec", () => {
    expect(issueTableGroupSpecFor("status")).toEqual({ kind: "status" });
    expect(issueTableGroupSpecFor("assignee")).toEqual({ kind: "assignee" });
    expect(issueTableGroupSpecFor("property:p1")).toEqual({
      kind: "property",
      property_id: "p1",
    });
  });

  it("returns null when the table is ungrouped", () => {
    expect(issueTableGroupSpecFor("none")).toBeNull();
  });
});

describe("workspaceIssueTableScope", () => {
  it("keeps `all` unscoped and compiles the actor tabs to assignee_types", () => {
    expect(workspaceIssueTableScope("all")).toEqual({ kind: "workspace" });
    expect(workspaceIssueTableScope("members")).toEqual({
      kind: "workspace",
      assignee_types: ["member"],
    });
    // Agents tab counts squads as agent work, same as the client predicate.
    expect(workspaceIssueTableScope("agents")).toEqual({
      kind: "workspace",
      assignee_types: ["agent", "squad"],
    });
  });
});

describe("myIssueTableScope", () => {
  it("compiles every tab to one relation, including the union", () => {
    expect(myIssueTableScope("all")).toEqual({ kind: "my", relation: "any" });
    expect(myIssueTableScope("assigned")).toEqual({
      kind: "my",
      relation: "assigned",
    });
    expect(myIssueTableScope("created")).toEqual({
      kind: "my",
      relation: "created",
    });
    expect(myIssueTableScope("agents")).toEqual({
      kind: "my",
      relation: "involved",
    });
  });
});

describe("buildIssueTableGroupQuerySpec", () => {
  const scope = { kind: "workspace" } as const;

  it("maps every active window dimension onto the spec's filters", () => {
    const spec = buildIssueTableGroupQuerySpec(scope, {
      statuses: ["todo", "done"],
      priorities: ["high"],
      assignee_filters: [{ type: "member", id: "u1" }],
      include_no_assignee: true,
      creator_filters: [{ type: "agent", id: "a1" }],
      project_ids: ["pr1"],
      include_no_project: true,
      label_ids: ["l1"],
      properties: { p1: ["opt"] },
      date_field: "created_at",
      date_start: "2026-09-01T00:00:00.000Z",
      date_end: "2026-09-08T00:00:00.000Z",
    });
    expect(spec).toEqual({
      scope,
      filters: {
        statuses: ["todo", "done"],
        priorities: ["high"],
        assignees: [{ type: "member", id: "u1" }],
        include_no_assignee: true,
        creators: [{ type: "agent", id: "a1" }],
        project_ids: ["pr1"],
        include_no_project: true,
        label_ids: ["l1"],
        properties: { p1: ["opt"] },
        date: {
          field: "created_at",
          start: "2026-09-01T00:00:00.000Z",
          end: "2026-09-08T00:00:00.000Z",
        },
        include_sub_issues: true,
      },
      sort: { field: "position", direction: "asc" },
    });
  });

  it("omits inactive dimensions instead of sending empty ones", () => {
    expect(buildIssueTableGroupQuerySpec(scope, {})).toEqual({
      scope,
      filters: { include_sub_issues: true },
      sort: { field: "position", direction: "asc" },
    });
    expect(
      buildIssueTableGroupQuerySpec(scope, {
        statuses: [],
        properties: {},
        // A partial date band is not a filter — the server wants all three.
        date_field: "created_at",
        date_start: "2026-09-01T00:00:00.000Z",
      }).filters,
    ).toEqual({ include_sub_issues: true });
  });

  it("carries the surface's show-sub-issues toggle", () => {
    expect(
      buildIssueTableGroupQuerySpec(scope, {}, false).filters
        .include_sub_issues,
    ).toBe(false);
  });

  it("drops the window's sort — counts do not depend on it", () => {
    const spec = buildIssueTableGroupQuerySpec(scope, {
      sort_by: "due_date",
      sort_direction: "desc",
      statuses: ["todo"],
    });
    expect(spec.sort).toEqual({ field: "position", direction: "asc" });
    expect(spec.filters.statuses).toEqual(["todo"]);
  });
});

describe("serverGroupKey", () => {
  const descriptor = (value: IssueTableGroupValue) => value;

  it("reproduces the local status and assignee keys", () => {
    expect(serverGroupKey(descriptor({ kind: "status", status: "todo" }))).toBe(
      "status:todo",
    );
    expect(
      serverGroupKey(
        descriptor({
          kind: "assignee",
          actor: { type: "member", id: "u1" },
        }),
      ),
    ).toBe("assignee:member:u1");
    expect(
      serverGroupKey(descriptor({ kind: "assignee", actor: null })),
    ).toBe("assignee:unassigned");
  });

  it("reproduces the local property keys from the decoded value", () => {
    expect(
      serverGroupKey(
        descriptor({
          kind: "property",
          property_id: "p1",
          value_state: "unset",
        }),
      ),
    ).toBe("property:p1:unset");
    expect(
      serverGroupKey(
        descriptor({
          kind: "property",
          property_id: "p1",
          value_state: "value",
          value: "opt1",
        }),
      ),
    ).toBe("property:p1:value:opt1");
    // Checkbox values arrive as booleans; the local key stringifies them.
    expect(
      serverGroupKey(
        descriptor({
          kind: "property",
          property_id: "p1",
          value_state: "value",
          value: true,
        }),
      ),
    ).toBe("property:p1:value:true");
    // A deleted option keeps its stale id in both key shapes.
    expect(
      serverGroupKey(
        descriptor({
          kind: "property",
          property_id: "p1",
          value_state: "unavailable",
          value: "ghost",
        }),
      ),
    ).toBe("property:p1:unavailable:ghost");
    // No stale value at all → the bare bucket.
    expect(
      serverGroupKey(
        descriptor({
          kind: "property",
          property_id: "p1",
          value_state: "unavailable",
        }),
      ),
    ).toBe("property:p1:unavailable");
  });

  it("returns null for dimensions mobile cannot render", () => {
    expect(
      serverGroupKey(descriptor({ kind: "project", project_id: "pr1" })),
    ).toBeNull();
    expect(
      serverGroupKey(
        descriptor({
          kind: "parent",
          parent_id: null,
          parent: null,
          value_state: "unset",
        }),
      ),
    ).toBeNull();
    // A "value" state with no value at all is not renderable either.
    expect(
      serverGroupKey(
        descriptor({
          kind: "property",
          property_id: "p1",
          value_state: "value",
          value: null,
        }),
      ),
    ).toBeNull();
  });
});

describe("serverGroupCountMap", () => {
  it("keys counts by the local group key and drops unmappable descriptors", () => {
    const groups: IssueTableGroupDescriptor[] = [
      { key: "status:todo", value: { kind: "status", status: "todo" }, count: 12 },
      {
        key: "status:done",
        value: { kind: "status", status: "done" },
        count: 340,
      },
      {
        key: "project:pr1",
        value: { kind: "project", project_id: "pr1" },
        count: 5,
      },
    ];
    const counts = serverGroupCountMap(groups);
    expect(counts.get("status:todo")).toBe(12);
    expect(counts.get("status:done")).toBe(340);
    expect(counts.size).toBe(2);
  });
});
