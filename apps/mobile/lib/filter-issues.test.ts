/**
 * Unit tests for the issue-list predicate + sort + grouping helpers —
 * the core "same N rule" guarantee that the mobile list shows exactly what
 * web's `applyIssueFilters` / `sortIssues` produce for the same filter
 * input (MYS-408 issue workbench).
 */
import { describe, expect, it } from "vitest";
import type { Issue, IssueStatus, Label } from "@multica/core/types";
import {
  applyIssueFilters,
  groupIssues,
  issueMatchesPropertyFilters,
  sortIssues,
  type IssueFilterState,
} from "./filter-issues";

// Inlined copy of lib/issue-status BOARD_STATUSES (that module pulls i18n →
// expo, which is out of scope for this pure-helper suite).
const BOARD_STATUSES: IssueStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
];

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
    assignee_type: partial.assignee_type,
    assignee_id: partial.assignee_id,
    creator_type: partial.creator_type,
    creator_id: partial.creator_id,
    project_id: partial.project_id,
    labels: partial.labels,
    properties: partial.properties,
    start_date: partial.start_date,
    due_date: partial.due_date,
  } as Issue;
}

function label(id: string, name: string, color: string): Label {
  return {
    id,
    name,
    color,
    workspace_id: "ws1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const noFilters: IssueFilterState = {
  statusFilters: [],
  priorityFilters: [],
  assigneeFilters: [],
  includeNoAssignee: false,
  creatorFilters: [],
  projectFilters: [],
  includeNoProject: false,
  labelFilters: [],
  propertyFilters: {},
  dateFilter: null,
};

describe("applyIssueFilters", () => {
  const a = issue({
    id: "a",
    status: "todo",
    priority: "high",
    assignee_type: "member",
    assignee_id: "u1",
    creator_type: "member",
    creator_id: "u2",
    project_id: "p1",
    labels: [label("l1", "bug", "#f00")],
  });
  const unassigned = issue({
    id: "b",
    status: "in_progress",
    priority: "none",
    project_id: "p2",
  });
  const agent = issue({
    id: "c",
    status: "done",
    priority: "low",
    assignee_type: "agent",
    assignee_id: "ag1",
    creator_type: "agent",
    creator_id: "ag2",
    labels: [label("l2", "feature", "#0a0")],
  });
  const all = [a, unassigned, agent];

  it("empty filters = show all", () => {
    expect(applyIssueFilters(all, noFilters)).toEqual(all);
  });

  it("status + priority filter", () => {
    const out = applyIssueFilters(all, {
      ...noFilters,
      statusFilters: ["todo"],
      priorityFilters: ["high"],
    });
    expect(out.map((i) => i.id)).toEqual(["a"]);
  });

  it("assignee filter matches type+id; unassigned hides unless includeNoAssignee", () => {
    const byMember = applyIssueFilters(all, {
      ...noFilters,
      assigneeFilters: [{ type: "member", id: "u1" }],
    });
    expect(byMember.map((i) => i.id)).toEqual(["a"]);

    // includeNoAssignee alone → only unassigned
    const onlyNoAssignee = applyIssueFilters(all, {
      ...noFilters,
      includeNoAssignee: true,
    });
    expect(onlyNoAssignee.map((i) => i.id)).toEqual(["b"]);

    // both → member + unassigned
    const both = applyIssueFilters(all, {
      ...noFilters,
      assigneeFilters: [{ type: "member", id: "u1" }],
      includeNoAssignee: true,
    });
    expect(both.map((i) => i.id).sort()).toEqual(["a", "b"]);
  });

  it("creator filter (agent creator preserved separately)", () => {
    const out = applyIssueFilters(all, {
      ...noFilters,
      creatorFilters: [{ type: "member", id: "u2" }],
    });
    expect(out.map((i) => i.id)).toEqual(["a"]);
  });

  it("project filter + includeNoProject", () => {
    const byProject = applyIssueFilters(all, {
      ...noFilters,
      projectFilters: ["p1"],
    });
    expect(byProject.map((i) => i.id)).toEqual(["a"]);

    const noProject = applyIssueFilters(all, {
      ...noFilters,
      includeNoProject: true,
    });
    // a has p1, b has p2, c has no project → only c
    expect(noProject.map((i) => i.id)).toEqual(["c"]);
  });

  it("label filter is OR within the group", () => {
    const out = applyIssueFilters(all, {
      ...noFilters,
      labelFilters: ["l1", "l2"],
    });
    expect(out.map((i) => i.id).sort()).toEqual(["a", "c"]);
    expect(
      applyIssueFilters(all, { ...noFilters, labelFilters: ["l99"] }),
    ).toEqual([]);
  });
});

describe("sortIssues", () => {
  const mk = (id: string, partial: Partial<Issue>): Issue =>
    issue({
      id,
      title: `T${id}`,
      position: Number(id),
      priority: "none",
      created_at: "2026-01-01T00:00:00Z",
      ...partial,
    });

  it("position asc/desc", () => {
    const list = [mk("2", {}), mk("1", {}), mk("3", {})];
    expect(sortIssues(list, "position", "asc").map((i) => i.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(sortIssues(list, "position", "desc").map((i) => i.id)).toEqual([
      "3",
      "2",
      "1",
    ]);
  });

  it("priority asc follows urgent>high>…>none", () => {
    const list = [
      mk("none", { priority: "none" }),
      mk("urgent", { priority: "urgent" }),
      mk("high", { priority: "high" }),
    ];
    expect(sortIssues(list, "priority", "asc").map((i) => i.id)).toEqual([
      "urgent",
      "high",
      "none",
    ]);
    expect(sortIssues(list, "priority", "desc").map((i) => i.id)).toEqual([
      "none",
      "high",
      "urgent",
    ]);
  });

  it("status asc follows BOARD_STATUSES order", () => {
    const list = [
      mk("done", { status: "done" }),
      mk("todo", { status: "todo" }),
      mk("in_progress", { status: "in_progress" }),
    ];
    expect(sortIssues(list, "status", "asc").map((i) => i.id)).toEqual([
      "todo",
      "in_progress",
      "done",
    ]);
  });

  it("title locale aware asc/desc", () => {
    const list = [mk("b", { title: "Banana" }), mk("a", { title: "Apple" })];
    expect(sortIssues(list, "title", "asc").map((i) => i.id)).toEqual([
      "a",
      "b",
    ]);
    expect(sortIssues(list, "title", "desc").map((i) => i.id)).toEqual([
      "b",
      "a",
    ]);
  });

  it("missing start_date sorts last in BOTH directions", () => {
    const list = [
      mk("a", { start_date: "2026-02-01" }),
      mk("b", {}),
      mk("c", { start_date: "2026-01-01" }),
    ];
    expect(sortIssues(list, "start_date", "asc").map((i) => i.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(sortIssues(list, "start_date", "desc").map((i) => i.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });
});

describe("groupIssues", () => {
  const a = issue({ id: "a", status: "todo", assignee_type: "member", assignee_id: "u1" });
  const b = issue({ id: "b", status: "todo" });
  const c = issue({ id: "c", status: "done", assignee_type: "agent", assignee_id: "ag1" });

  it("status grouping uses BOARD_STATUSES order and drops empties", () => {
    const groups = groupIssues([c, a, b], "status", BOARD_STATUSES);
    const statuses = groups.map((g) => g.status);
    expect(statuses).toEqual(["todo", "done"]);
    expect(groups[0]?.data.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("status grouping keeps empty columns in BOARD_STATUSES order when includeEmpty is set", () => {
    const groups = groupIssues([c, a, b], "status", BOARD_STATUSES, true);
    const statuses = groups.map((g) => g.status);
    expect(statuses).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "done",
      "blocked",
    ]);
    const asMap = new Map(groups.map((g) => [g.status, g.data]));
    expect(asMap.get("done")?.map((i) => i.id)).toEqual(["c"]);
    expect(asMap.get("backlog")).toEqual([]);
    expect(asMap.get("blocked")).toEqual([]);
  });

  it("assignee grouping ignores includeEmpty (lanes are data-driven)", () => {
    const plain = groupIssues([a, b, c], "assignee", BOARD_STATUSES);
    const withEmpty = groupIssues([a, b, c], "assignee", BOARD_STATUSES, true);
    expect(withEmpty.map((g) => g.key)).toEqual(plain.map((g) => g.key));
    expect(withEmpty.map((g) => g.data)).toEqual(plain.map((g) => g.data));
  });

  it("assignee grouping: unassigned lane first, then alphabetical by key", () => {
    const groups = groupIssues([a, b, c], "assignee", BOARD_STATUSES);
    const keys = groups.map((g) => g.key);
    expect(keys).toEqual(["none", "agent:ag1", "member:u1"]);
    expect(groups[0]?.unassigned).toBe(true);
    expect(groups[0]?.data.map((i) => i.id)).toEqual(["b"]);
    expect(groups[1]?.assigneeId).toBe("ag1");
  });
});
/**
 * Custom-property filters (MYS-419). Mirrors web's `issueMatchesPropertyFilters`
 * at packages/views/issues/utils/filter.ts:61-82: OR within a definition, AND
 * across definitions; an issue with no value for a filtered definition never
 * matches it.
 */
describe("issueMatchesPropertyFilters", () => {
  const mk = (properties?: Record<string, unknown>) =>
    issue({ id: "p", properties } as Partial<Issue>);

  it("empty / undefined filters match everything", () => {
    expect(issueMatchesPropertyFilters(mk(), undefined)).toBe(true);
    expect(issueMatchesPropertyFilters(mk(), {})).toBe(true);
  });

  it("select matches its single option value", () => {
    const item = mk({ def: "opt-a" });
    expect(issueMatchesPropertyFilters(item, { def: ["opt-a"] })).toBe(true);
    expect(issueMatchesPropertyFilters(item, { def: ["opt-b"] })).toBe(false);
  });

  it("multi_select matches when any selected option is present (OR within)", () => {
    const item = mk({ def: ["opt-a", "opt-c"] });
    expect(issueMatchesPropertyFilters(item, { def: ["opt-b", "opt-a"] })).toBe(
      true,
    );
    expect(issueMatchesPropertyFilters(item, { def: ["opt-b", "opt-d"] })).toBe(
      false,
    );
  });

  it("checkbox compares booleans via the true/false pseudo-options", () => {
    const checked = mk({ chk: true });
    expect(issueMatchesPropertyFilters(checked, { chk: ["true"] })).toBe(true);
    expect(issueMatchesPropertyFilters(checked, { chk: ["false"] })).toBe(false);
    const unchecked = mk({ chk: false });
    expect(issueMatchesPropertyFilters(unchecked, { chk: ["false"] })).toBe(
      true,
    );
  });

  it("an issue with no value for a filtered definition never matches", () => {
    expect(issueMatchesPropertyFilters(mk({ other: "x" }), { def: ["a"] })).toBe(
      false,
    );
  });

  it("AND across definitions — all must pass", () => {
    const item = mk({ defA: "a", defB: "b" });
    expect(
      issueMatchesPropertyFilters(item, { defA: ["a"], defB: ["b"] }),
    ).toBe(true);
    expect(
      issueMatchesPropertyFilters(item, { defA: ["a"], defB: ["c"] }),
    ).toBe(false);
  });
});

describe("applyIssueFilters with propertyFilters", () => {
  it("filters by property while keeping other dimensions", () => {
    const list = [
      issue({ id: "a", status: "todo", properties: { def: "x" } }),
      issue({ id: "b", status: "todo", properties: { def: "y" } }),
      issue({ id: "c", status: "done", properties: { def: "x" } }),
    ];
    const filtered = applyIssueFilters(list, {
      ...noFilters,
      statusFilters: ["todo"],
      propertyFilters: { def: ["x"] },
    });
    expect(filtered.map((i) => i.id)).toEqual(["a"]);
  });
});
