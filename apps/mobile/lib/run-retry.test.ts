import { describe, expect, it } from "vitest";
import { canRerunRun, isInvocationBlocked } from "./run-retry";

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