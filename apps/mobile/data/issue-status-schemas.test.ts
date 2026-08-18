/**
 * Issue-status catalog schema parse tests (MUL-6243): lenient parse with
 * defaults, and the 404-fallback envelope shape.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_LIST_ISSUE_STATUSES_RESPONSE,
  IssueStatusEntrySchema,
  ListIssueStatusesResponseSchema,
} from "./schemas";

describe("IssueStatusEntrySchema", () => {
  it("parses a minimal entry with defaults", () => {
    const parsed = IssueStatusEntrySchema.parse({
      id: "st-1",
      workspace_id: "ws-1",
      key: "qa",
      name: "QA",
      category: "in_review",
      created_at: "2026-08-18T00:00:00Z",
      updated_at: "2026-08-18T00:00:00Z",
    });
    expect(parsed.description).toBe("");
    expect(parsed.color).toBe("#6b7280");
    expect(parsed.is_system).toBe(false);
    expect(parsed.position).toBe(0);
    expect(parsed.archived_at).toBeNull();
  });

  it("tolerates unknown fields (loose)", () => {
    const parsed = IssueStatusEntrySchema.parse({
      id: "st-1",
      workspace_id: "ws-1",
      key: "qa",
      name: "QA",
      category: "in_review",
      some_future_field: "x",
      created_at: "2026-08-18T00:00:00Z",
      updated_at: "2026-08-18T00:00:00Z",
    });
    expect(parsed.key).toBe("qa");
  });
});

describe("ListIssueStatusesResponseSchema", () => {
  it("defaults missing arrays to empty", () => {
    const parsed = ListIssueStatusesResponseSchema.parse({});
    expect(parsed.statuses).toEqual([]);
    expect(parsed.categories).toEqual([]);
    expect(parsed.total).toBe(0);
  });

  it("carries the canonical categories in the empty fallback", () => {
    expect(EMPTY_LIST_ISSUE_STATUSES_RESPONSE.categories).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "done",
      "blocked",
      "cancelled",
    ]);
    expect(EMPTY_LIST_ISSUE_STATUSES_RESPONSE.statuses).toEqual([]);
  });
});