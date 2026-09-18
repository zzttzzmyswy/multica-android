import { describe, expect, it } from "vitest";
import { classifyError, isConnectionError, mapAuthError } from "./auth-error";

/** ApiError lives in the data layer, which pulls in the native fetch chain.
 *  The classifier only duck-types status/message, so a stand-in keeps this
 *  suite headless. */
function apiError(message: string, status: number): Error {
  const err = new Error(message);
  err.name = "ApiError";
  Object.assign(err, { status });
  return err;
}

describe("classifyError", () => {
  it("classifies a transport failure (status 0) as offline", () => {
    expect(classifyError(apiError("Network request failed", 0))).toBe("offline");
    expect(
      classifyError(apiError("Request timed out after 30000ms", 0)),
    ).toBe("offline");
  });

  it("classifies a raw fetch rejection by name/message as offline", () => {
    const typeError = new TypeError("Network request failed");
    expect(classifyError(typeError)).toBe("offline");
  });

  it("classifies HTTP auth failures by message, not by transport", () => {
    expect(classifyError(apiError("invalid code", 400))).toBe("auth");
    expect(classifyError(apiError("code expired", 400))).toBe("auth");
    expect(classifyError(apiError("too many attempts", 429))).toBe("auth");
  });

  it("treats a 5xx from a reachable server as server-side, not offline", () => {
    expect(classifyError(apiError("internal server error", 500))).toBe("other");
  });

  it("returns unknown for non-Error values and unremarkable errors", () => {
    expect(classifyError("boom")).toBe("unknown");
    expect(classifyError(new Error("something else"))).toBe("unknown");
  });
});

describe("isConnectionError", () => {
  it("is true only for offline-class failures", () => {
    expect(isConnectionError(apiError("Network request failed", 0))).toBe(true);
    expect(isConnectionError(new TypeError("Network request failed"))).toBe(true);
    expect(isConnectionError(apiError("invalid code", 400))).toBe(false);
    expect(isConnectionError(apiError("internal server error", 500))).toBe(false);
    expect(isConnectionError(undefined)).toBe(false);
  });
});

describe("mapAuthError", () => {
  const t = (id: string) => id;

  it("says 'can't reach Multica' for a transport failure, not the generic fallback", () => {
    // Regression: RN rejects fetch with a bare TypeError before ApiClient
    // normalised it, so an unreachable host used to surface as the vague
    // "couldn't send the code" instead of a connection message.
    expect(mapAuthError(new TypeError("Network request failed"), "fallback", t)).toBe(
      "auth.networkError",
    );
    expect(mapAuthError(apiError("Network request failed", 0), "fallback", t)).toBe(
      "auth.networkError",
    );
    expect(mapAuthError(apiError("Request timed out after 30000ms", 0), "fallback", t)).toBe(
      "auth.networkError",
    );
  });

  it("keeps the specific auth messages for HTTP failures", () => {
    expect(mapAuthError(apiError("expired code", 400), "fallback", t)).toBe(
      "auth.codeExpired",
    );
    expect(mapAuthError(apiError("too many attempts", 429), "fallback", t)).toBe(
      "auth.tooManyAttempts",
    );
    expect(mapAuthError(apiError("invalid code", 400), "fallback", t)).toBe(
      "auth.codeMismatch",
    );
  });

  it("falls back for unrecognised errors", () => {
    expect(mapAuthError(new Error("kaboom"), "fallback", t)).toBe("fallback");
    expect(mapAuthError("boom", "fallback", t)).toBe("fallback");
  });
});
