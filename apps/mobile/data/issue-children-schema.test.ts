import { describe, expect, it } from "vitest";
import { ChildIssuesResponseSchema } from "./schemas";

/**
 * Client-side parsing of `GET /api/issues/:id/children` — backs
 * `ApiClient.listChildIssues` (data/api.ts), which returns `parsed.issues`.
 * Pins how this client reacts to a payload; a malformed/missing `issues` key
 * must not take the issue-detail page down (the sub-task section simply
 * hides itself on an empty array).
 */
describe("ChildIssuesResponseSchema", () => {
  it("parses the documented server payload into the inner issues array", () => {
    const parsed = ChildIssuesResponseSchema.parse({
      issues: [
        {
          id: "child-1",
          workspace_id: "ws-1",
          number: 2,
          identifier: "MUL-2",
          title: "child task",
          description: null,
          status: "todo",
          priority: "none",
          assignee_type: null,
          assignee_id: null,
          creator_type: "member",
          creator_id: "u-1",
          parent_issue_id: "parent-1",
          project_id: null,
          position: 0,
          stage: 1,
          start_date: null,
          due_date: null,
          metadata: {},
          properties: {},
          created_at: "2026-08-15T00:00:00Z",
          updated_at: "2026-08-15T00:00:00Z",
        },
      ],
    });
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]?.id).toBe("child-1");
    expect(parsed.issues[0]?.stage).toBe(1);
  });

  it("defaults to an empty array when the issues key is missing", () => {
    const parsed = ChildIssuesResponseSchema.parse({});
    expect(parsed.issues).toEqual([]);
  });

  it("rejects a row that fails IssueSchema, so the caller falls back to empty", () => {
    // `issues` is a strict array of IssueSchema rows — one malformed row
    // rejects the whole parse rather than silently dropping it. `listChildIssues`
    // runs this through `fetchValidated`, whose safeParse+fallback then turns
    // the reject into `EMPTY_CHILD_ISSUES_RESPONSE`, hiding the section.
    expect(() =>
      ChildIssuesResponseSchema.parse({ issues: [{ id: "bad" }] }),
    ).toThrow();
  });
});