import { describe, expect, it } from "vitest";
import {
  IssueSubscriberListSchema,
  IssueSubscriberSchema,
  SubscribeStatusSchema,
} from "./schemas";

describe("IssueSubscriberSchema", () => {
  it("parses a full subscriber row", () => {
    const parsed = IssueSubscriberSchema.parse({
      issue_id: "issue-1",
      user_type: "member",
      user_id: "user-1",
      reason: "assignee",
      created_at: "2026-08-17T00:00:00Z",
    });
    expect(parsed.issue_id).toBe("issue-1");
    expect(parsed.user_type).toBe("member");
    expect(parsed.reason).toBe("assignee");
    expect(parsed.created_at).toBe("2026-08-17T00:00:00Z");
  });

  it("handles an unknown reason string (open-ended, not dropped)", () => {
    const parsed = IssueSubscriberSchema.parse({
      issue_id: "issue-1",
      user_type: "agent",
      user_id: "agent-1",
      reason: "some-future-reason",
      created_at: "2026-08-17T00:00:00Z",
    });
    expect(parsed.reason).toBe("some-future-reason");
  });

  it("tolerates a missing reason (loose + default)", () => {
    const parsed = IssueSubscriberSchema.parse({
      issue_id: "issue-1",
      user_type: "member",
      user_id: "user-1",
      created_at: "2026-08-17T00:00:00Z",
    });
    expect(parsed.reason).toBe("manual");
  });

  it("passes through unknown extra fields (loose)", () => {
    const parsed = IssueSubscriberSchema.parse({
      issue_id: "issue-1",
      user_type: "member",
      user_id: "user-1",
      reason: "manual",
      created_at: "2026-08-17T00:00:00Z",
      future_field: 42,
    });
    expect((parsed as { future_field?: number }).future_field).toBe(42);
  });
});

describe("IssueSubscriberListSchema", () => {
  it("parses a list and defaults an undefined input to []", () => {
    expect(IssueSubscriberListSchema.parse(undefined)).toEqual([]);
    const parsed = IssueSubscriberListSchema.parse([
      {
        issue_id: "issue-1",
        user_type: "member",
        user_id: "user-1",
        reason: "manual",
        created_at: "2026-08-17T00:00:00Z",
      },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].user_id).toBe("user-1");
  });
});

describe("SubscribeStatusSchema", () => {
  it("parses a subscribe/unsubscribe response", () => {
    expect(SubscribeStatusSchema.parse({ subscribed: true }).subscribed).toBe(true);
    expect(SubscribeStatusSchema.parse({ subscribed: false }).subscribed).toBe(false);
  });

  it("defaults subscribed to false when the field is absent", () => {
    expect(SubscribeStatusSchema.parse({}).subscribed).toBe(false);
  });
});