import { describe, expect, it } from "vitest";
import {
  canRerunRun,
  isInvocationBlocked,
  retryableAgentFailureComment,
} from "./run-retry";

describe("canRerunRun", () => {
  const statuses = [
    "queued",
    "dispatched",
    "waiting_local_directory",
    "running",
    "completed",
    "failed",
    "cancelled",
  ];
  it("allows failed and cancelled only", () => {
    for (const s of statuses) {
      expect(canRerunRun(s)).toBe(s === "failed" || s === "cancelled");
    }
  });
});

describe("retryableAgentFailureComment", () => {
  const entry = (
    over: Partial<{
      actor_type: string | null;
      comment_type: string | null;
      source_task_id: string | null;
    }> = {},
  ) => ({
    actor_type: "agent",
    comment_type: "system",
    source_task_id: "task-1",
    ...over,
  });

  it("accepts an agent system comment carrying a task id", () => {
    expect(retryableAgentFailureComment(entry())).toBe(true);
  });

  it("rejects a member's system comment", () => {
    // No run stands behind a member's system comment, so retrying it would
    // POST a task id that was never issued.
    expect(retryableAgentFailureComment(entry({ actor_type: "member" }))).toBe(
      false,
    );
  });

  it("rejects a normal agent comment", () => {
    // Agent prose is not a failure notice; only the system row is retryable.
    expect(
      retryableAgentFailureComment(entry({ comment_type: "comment" })),
    ).toBe(false);
  });

  it("rejects a comment with no comment_type at all", () => {
    // Non-comment activity rows in the same timeline omit the field.
    expect(retryableAgentFailureComment(entry({ comment_type: null }))).toBe(
      false,
    );
    expect(
      retryableAgentFailureComment(entry({ comment_type: undefined })),
    ).toBe(false);
  });

  it("rejects a missing or empty source_task_id", () => {
    expect(retryableAgentFailureComment(entry({ source_task_id: null }))).toBe(
      false,
    );
    expect(retryableAgentFailureComment(entry({ source_task_id: "" }))).toBe(
      false,
    );
    expect(
      retryableAgentFailureComment(entry({ source_task_id: undefined })),
    ).toBe(false);
  });

  it("requires all three clauses at once", () => {
    // Each pair alone must fail — guards against a predicate that ORs.
    expect(
      retryableAgentFailureComment({
        actor_type: "agent",
        comment_type: "system",
        source_task_id: "",
      }),
    ).toBe(false);
    expect(
      retryableAgentFailureComment({
        actor_type: "agent",
        comment_type: "comment",
        source_task_id: "task-1",
      }),
    ).toBe(false);
    expect(
      retryableAgentFailureComment({
        actor_type: "member",
        comment_type: "system",
        source_task_id: "task-1",
      }),
    ).toBe(false);
  });
});

describe("isInvocationBlocked", () => {
  it("accepts a structured 403 with invocation_not_allowed", () => {
    const err = {
      status: 403,
      body: { reason_code: "invocation_not_allowed" },
    };
    expect(isInvocationBlocked(err)).toBe(true);
  });

  it("rejects a 403 without the matching reason code", () => {
    expect(isInvocationBlocked({ status: 403, body: {} })).toBe(false);
    expect(
      isInvocationBlocked({ status: 403, body: { reason_code: "other" } }),
    ).toBe(false);
  });

  it("rejects non-403 statuses and non-object bodies", () => {
    expect(isInvocationBlocked({ status: 500, body: {} })).toBe(false);
    expect(isInvocationBlocked({ status: 403, body: "plain text" })).toBe(false);
    expect(isInvocationBlocked(null)).toBe(false);
    expect(isInvocationBlocked(new Error("network"))).toBe(false);
  });

  it("accepts a real ApiError shape (duck-typed)", () => {
    class FakeApiError extends Error {
      readonly status: number;
      readonly body?: unknown;
      constructor(message: string, status: number, body?: unknown) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.body = body;
      }
    }
    expect(
      isInvocationBlocked(
        new FakeApiError("forbidden", 403, { reason_code: "invocation_not_allowed" }),
      ),
    ).toBe(true);
  });
});