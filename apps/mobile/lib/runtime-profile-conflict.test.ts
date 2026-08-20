/**
 * 409 bounded-agents conflict parsing (iteration-82, A2.3). Pure function —
 * the fixture ApiError is minted from the mocked @/data/api (same class the
 * module imports), so instanceof in `parseRuntimeProfileBoundConflict`
 * behaves exactly as in the app without pulling in the expo native chain.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/data/api", () => {
  class ApiError extends Error {
    readonly status: number;
    readonly body?: unknown;
    constructor(message: string, status: number, body?: unknown) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.body = body;
    }
  }
  return { api: {}, ApiError };
});

import { ApiError } from "@/data/api";
import { parseRuntimeProfileBoundConflict } from "./runtime-profile-conflict";

function apiError(status: number, body?: unknown, message = "boom") {
  return new ApiError(message, status, body);
}

describe("parseRuntimeProfileBoundConflict", () => {
  it("returns null for a non-409 error", () => {
    expect(parseRuntimeProfileBoundConflict(apiError(400, { message: "x" }))).toBeNull();
    expect(parseRuntimeProfileBoundConflict(new Error("network"))).toBeNull();
  });

  it("surfaces the server's body.message for a 409", () => {
    expect(
      parseRuntimeProfileBoundConflict(
        apiError(409, { message: "Agents are still bound to this profile" }),
      ),
    ).toEqual({ message: "Agents are still bound to this profile" });
  });

  it("falls back to body.error when message is absent", () => {
    expect(
      parseRuntimeProfileBoundConflict(apiError(409, { error: "still bound" })),
    ).toEqual({ message: "still bound" });
  });

  it("falls back to the error message when the 409 body is opaque", () => {
    expect(parseRuntimeProfileBoundConflict(apiError(409, null, "Conflict"))).toEqual({
      message: "Conflict",
    });
    expect(parseRuntimeProfileBoundConflict(apiError(409, { message: "" }))).toEqual(
      { message: "boom" },
    );
  });
});