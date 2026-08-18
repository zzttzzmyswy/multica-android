import { describe, expect, it } from "vitest";
import type { Issue } from "@multica/core/types";
import {
  applyBatchIssuePatch,
  commonIssueFields,
  dropIssueBatch,
  needRunConfirm,
  patchIssueBatch,
} from "./batch-issues";

function makeIssue(id: string, overrides: Partial<Issue> = {}): Issue {
  return {
    id,
    identifier: `MYS-${id.toUpperCase()}`,
    title: `issue ${id}`,
    status: "todo",
    priority: "medium",
    assignee_type: null,
    assignee_id: null,
    ...overrides,
  } as Issue;
}

describe("applyBatchIssuePatch", () => {
  it("applies status / priority / assignee changes", () => {
    const next = applyBatchIssuePatch(makeIssue("a"), {
      status: "done",
      priority: "high",
      assignee_type: "member",
      assignee_id: "u1",
    });
    expect(next.status).toBe("done");
    expect(next.priority).toBe("high");
    expect(next.assignee_type).toBe("member");
    expect(next.assignee_id).toBe("u1");
  });

  it("clearing assignee maps null through", () => {
    const next = applyBatchIssuePatch(
      makeIssue("a", { assignee_type: "member", assignee_id: "u1" }),
      { assignee_type: null, assignee_id: null },
    );
    expect(next.assignee_type).toBeNull();
    expect(next.assignee_id).toBeNull();
  });

  it("leaves untouched fields (and description) intact", () => {
    const issue = makeIssue("a", { title: "keep", description: "body" });
    const next = applyBatchIssuePatch(issue, { status: "in_progress" });
    expect(next.title).toBe("keep");
    expect(next.description).toBe("body");
  });
});

describe("patchIssueBatch", () => {
  it("patches only the selected ids and returns a new array", () => {
    const a = makeIssue("a");
    const b = makeIssue("b");
    const out = patchIssueBatch([a, b], ["b"], { status: "cancelled" });
    expect(out).not.toBe([a, b]);
    expect(out[0]).toBe(a);
    expect(out[1]?.status).toBe("cancelled");
  });

  it("returns a copy even for an empty selection", () => {
    const a = makeIssue("a");
    const out = patchIssueBatch([a], [], { status: "done" });
    expect(out).toEqual([a]);
    expect(out).not.toBe([a]);
  });
});

describe("dropIssueBatch", () => {
  it("removes selected ids and keeps the rest", () => {
    const a = makeIssue("a");
    const b = makeIssue("b");
    const c = makeIssue("c");
    const out = dropIssueBatch([a, b, c], ["a", "c"]);
    expect(out).toEqual([b]);
  });

  it("returns the same length when nothing matches", () => {
    const a = makeIssue("a");
    expect(dropIssueBatch([a], ["zz"])).toEqual([a]);
  });
});

describe("commonIssueFields", () => {
  it("reports the shared status / priority / assignee", () => {
    const a = makeIssue("a", {
      status: "in_progress",
      priority: "high",
      assignee_type: "agent",
      assignee_id: "ag1",
    });
    const b = makeIssue("b", {
      status: "in_progress",
      priority: "high",
      assignee_type: "agent",
      assignee_id: "ag1",
    });
    expect(commonIssueFields([a, b])).toEqual({
      status: "in_progress",
      priority: "high",
      assignee: { type: "agent", id: "ag1" },
    });
  });

  it("reports null per field when the selection is mixed", () => {
    const a = makeIssue("a", {
      status: "todo",
      priority: "low",
      assignee_type: "member",
      assignee_id: "u1",
    });
    const b = makeIssue("b", {
      status: "done",
      priority: "medium",
      assignee_type: "agent",
      assignee_id: "ag1",
    });
    expect(commonIssueFields([a, b])).toEqual({
      status: null,
      priority: null,
      assignee: null,
    });
  });

  it("treats all-unassigned as the real shared value, distinct from mixed", () => {
    const a = makeIssue("a");
    const b = makeIssue("b");
    expect(commonIssueFields([a, b]).assignee).toEqual({
      type: null,
      id: null,
    });
    const assigned = makeIssue("c", { assignee_type: "member", assignee_id: "u1" });
    expect(commonIssueFields([a, assigned]).assignee).toBeNull();
  });

  it("distinguishes assignees by type + id composite key", () => {
    // Same id but different actor kind is NOT a shared value.
    const member = makeIssue("a", { assignee_type: "member", assignee_id: "x1" });
    const agent = makeIssue("b", { assignee_type: "agent", assignee_id: "x1" });
    expect(commonIssueFields([member, agent]).assignee).toBeNull();
  });

  it("returns all-null for an empty selection", () => {
    expect(commonIssueFields([])).toEqual({
      status: null,
      priority: null,
      assignee: null,
    });
  });
});

describe("needRunConfirm", () => {
  it("never confirms member assignments", () => {
    const issues = [makeIssue("a"), makeIssue("b")];
    expect(needRunConfirm(issues, "member")).toBe(false);
    expect(needRunConfirm(issues, null)).toBe(false);
  });

  it("confirms agent/squad assignment when any issue can start a run", () => {
    const issues = [
      makeIssue("a", { status: "todo" }),
      makeIssue("b", { status: "in_progress" }),
    ];
    expect(needRunConfirm(issues, "agent")).toBe(true);
    expect(needRunConfirm(issues, "squad")).toBe(true);
  });

  it("short-circuits an all-backlog selection (parking lot)", () => {
    const issues = [
      makeIssue("a", { status: "backlog" }),
      makeIssue("b", { status: "backlog" }),
    ];
    expect(needRunConfirm(issues, "agent")).toBe(false);
  });

  it("returns false for an empty selection", () => {
    expect(needRunConfirm([], "agent")).toBe(false);
  });
});