/**
 * Unit tests for `groupSubIssuesByStage`, the pure ordering helper behind
 * the issue detail sub-task section.
 *
 * It mirrors web's ordering (packages/views/issues/components/
 * issue-detail.tsx:398) so the mobile and web clients render a parent's
 * children in the same sequence: staged groups ascending, unstaged last.
 */
import { describe, expect, it } from "vitest";
import type { Issue } from "@multica/core/types";
import { groupSubIssuesByStage } from "./sub-issue-grouping";

function makeIssue(overrides: Partial<Issue> & { id: string }): Issue {
  return {
    workspace_id: "ws",
    number: 1,
    identifier: "MUL-1",
    title: "task",
    description: null,
    status: "todo",
    priority: "none",
    assignee_type: null,
    assignee_id: null,
    creator_type: "member",
    creator_id: "u",
    parent_issue_id: "parent",
    project_id: null,
    position: 0,
    stage: null,
    start_date: null,
    due_date: null,
    metadata: {},
    properties: {},
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("groupSubIssuesByStage", () => {
  it("returns an empty array for no children", () => {
    expect(groupSubIssuesByStage([])).toEqual([]);
  });

  it("puts all-unstaged children in a single trailing group with null stage", () => {
    const a = makeIssue({ id: "a" });
    const b = makeIssue({ id: "b" });
    expect(groupSubIssuesByStage([a, b])).toEqual([
      { stage: null, items: [a, b] },
    ]);
  });

  it("orders staged groups ascending, preserving input order within a stage", () => {
    const a = makeIssue({ id: "a", stage: 2 });
    const b = makeIssue({ id: "b", stage: 1 });
    const c = makeIssue({ id: "c", stage: 1 });
    expect(groupSubIssuesByStage([a, b, c])).toEqual([
      { stage: 1, items: [b, c] },
      { stage: 2, items: [a] },
    ]);
  });

  it("places the unstaged group last, after every staged group", () => {
    const a = makeIssue({ id: "a", stage: 3 });
    const un = makeIssue({ id: "un" });
    const b = makeIssue({ id: "b", stage: 1 });
    expect(groupSubIssuesByStage([a, un, b])).toEqual([
      { stage: 1, items: [b] },
      { stage: 3, items: [a] },
      { stage: null, items: [un] },
    ]);
  });
});