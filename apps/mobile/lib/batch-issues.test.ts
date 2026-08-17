import { describe, expect, it } from "vitest";
import type { Issue } from "@multica/core/types";
import {
  applyBatchIssuePatch,
  dropIssueBatch,
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