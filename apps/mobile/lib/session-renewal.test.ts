/**
 * Pins the wiring half of session renewal (MYS-2538): what the app does with
 * each kind of answer.
 *
 * The property that matters most is the one the user would notice: a renewal
 * that cannot be performed must leave the session EXACTLY as it was. Renewal is
 * not a session event, so offline, 5xx and a malformed body may not look like a
 * login or a logout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshSession = vi.fn();
const setToken = vi.fn();
const commitRenewedToken = vi.fn();

vi.mock("@/data/api", () => ({
  api: {
    refreshSession: (...args: unknown[]) => refreshSession(...args),
    setToken: (...args: unknown[]) => setToken(...args),
  },
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
}));

vi.mock("@/data/secure-storage", () => ({
  commitRenewedToken: (...args: unknown[]) => commitRenewedToken(...args),
}));

import {
  __resetRenewalScheduleForTests,
  maybeRenewSession,
  renewSessionNow,
} from "./session-renewal";

beforeEach(() => {
  __resetRenewalScheduleForTests();
  refreshSession.mockReset();
  setToken.mockReset();
  commitRenewedToken.mockReset();
  commitRenewedToken.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("renewSessionNow", () => {
  it("commits and adopts a renewed token", async () => {
    refreshSession.mockResolvedValue({
      renewed: true,
      token: "new-token",
      expires_at: "2027-01-01T00:00:00Z",
      check_again_in_seconds: 86400,
    });

    await renewSessionNow();

    expect(commitRenewedToken).toHaveBeenCalledWith("new-token");
    // Adopted in memory only AFTER it is durable: a token that will not survive
    // a relaunch is worse than the one already in use.
    expect(setToken).toHaveBeenCalledWith("new-token");
    expect(commitRenewedToken.mock.invocationCallOrder[0]).toBeLessThan(
      setToken.mock.invocationCallOrder[0]!,
    );
  });

  it("does nothing when the session is not in its renewal window", async () => {
    refreshSession.mockResolvedValue({
      renewed: false,
      check_again_in_seconds: 86400,
    });

    await renewSessionNow();

    expect(commitRenewedToken).not.toHaveBeenCalled();
    expect(setToken).not.toHaveBeenCalled();
  });

  it("keeps the session when the network fails", async () => {
    refreshSession.mockRejectedValue(new Error("network down"));

    // Must not throw: a renewal failure is not something the UI can act on, and
    // surfacing it would report a session problem the reader does not have.
    await expect(renewSessionNow()).resolves.toBeUndefined();
    expect(commitRenewedToken).not.toHaveBeenCalled();
    expect(setToken).not.toHaveBeenCalled();
  });

  it("keeps the session when the server 500s", async () => {
    const { ApiError } = await import("@/data/api");
    refreshSession.mockRejectedValue(new ApiError("boom", 500));

    await renewSessionNow();

    expect(setToken).not.toHaveBeenCalled();
  });

  it("does not sign out on a 401 — that is onUnauthorized's job, once", async () => {
    // Renewal must not duplicate the logout path: `api.setOptions` wires
    // onUnauthorized to clear the store, the token and the cache. A second
    // implementation here would race it.
    const { ApiError } = await import("@/data/api");
    refreshSession.mockRejectedValue(new ApiError("expired", 401));

    await renewSessionNow();

    expect(setToken).not.toHaveBeenCalled();
    expect(commitRenewedToken).not.toHaveBeenCalled();
  });

  it("does not adopt a renewal that carried no token", async () => {
    refreshSession.mockResolvedValue({
      renewed: true,
      check_again_in_seconds: 86400,
    });

    await renewSessionNow();

    expect(commitRenewedToken).not.toHaveBeenCalled();
    expect(setToken).not.toHaveBeenCalled();
  });

  it("collapses concurrent triggers into one request", async () => {
    // Launch and a foreground transition can land together; two renewals would
    // leave two valid tokens racing to be written.
    refreshSession.mockResolvedValue({ renewed: false, check_again_in_seconds: 86400 });

    await Promise.all([renewSessionNow(), renewSessionNow(), renewSessionNow()]);

    expect(refreshSession).toHaveBeenCalledTimes(1);
  });
});

describe("maybeRenewSession", () => {
  it("checks immediately on a fresh schedule", () => {
    refreshSession.mockResolvedValue({ renewed: false, check_again_in_seconds: 86400 });
    maybeRenewSession();
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("respects the cadence afterwards, so a touch does not trigger a request", async () => {
    refreshSession.mockResolvedValue({
      renewed: false,
      check_again_in_seconds: 3 * 24 * 60 * 60,
    });
    await renewSessionNow();
    refreshSession.mockClear();

    maybeRenewSession();
    maybeRenewSession();

    expect(refreshSession).not.toHaveBeenCalled();
  });
});
