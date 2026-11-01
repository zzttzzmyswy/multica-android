/**
 * Pins for the session-renewal decision layer (MYS-2538).
 *
 * The two waits that must never share a number:
 *   - after a success, the SERVER's cadence (which can be days);
 *   - after a failure, a short backoff.
 *
 * Sharing them is the failure mode that makes renewal useless in the ordinary
 * case rather than only at short TTLs: a client told "check again in 3 days" on
 * day 12, returning on day 29 with one day left and hitting one 503, would be
 * blocked until day 32 — two days after the session expired.
 */
import { describe, expect, it } from "vitest";
import {
  MIN_CHECK_INTERVAL_MS,
  RENEW_RETRY_DELAYS_MS,
  nextCheckAt,
  renewedToken,
  shouldCheck,
  type RenewalResponse,
} from "./session-renewal-policy";

const NOW = 1_800_000_000_000;

function response(over: Partial<RenewalResponse> = {}): RenewalResponse {
  return {
    renewed: false,
    check_again_in_seconds: 3 * 24 * 60 * 60,
    ...over,
  };
}

describe("nextCheckAt — success", () => {
  it("uses the server's cadence", () => {
    const threeDays = 3 * 24 * 60 * 60;
    expect(
      nextCheckAt(
        { now: NOW, consecutiveFailures: 0 },
        { kind: "success", response: response({ check_again_in_seconds: threeDays }) },
      ),
    ).toBe(NOW + threeDays * 1000);
  });

  it("never schedules sooner than the server's own floor", () => {
    // A zero / missing cadence must not authorise a check on every tap.
    expect(
      nextCheckAt(
        { now: NOW, consecutiveFailures: 0 },
        { kind: "success", response: response({ check_again_in_seconds: 0 }) },
      ),
    ).toBe(NOW + MIN_CHECK_INTERVAL_MS);
  });

  it("treats a malformed cadence as the floor rather than as 'now'", () => {
    expect(
      nextCheckAt(
        { now: NOW, consecutiveFailures: 0 },
        {
          kind: "success",
          response: response({ check_again_in_seconds: Number.NaN }),
        },
      ),
    ).toBe(NOW + MIN_CHECK_INTERVAL_MS);
  });
});

describe("nextCheckAt — failure", () => {
  it("retries quickly instead of consuming the multi-day cadence", () => {
    const at = nextCheckAt(
      { now: NOW, consecutiveFailures: 0 },
      { kind: "failure" },
    );
    // The whole point: a failure must be retried in seconds, not days.
    expect(at - NOW).toBe(RENEW_RETRY_DELAYS_MS[0]);
    expect(at).toBeLessThan(NOW + 60_000);
  });

  it("backs off further on consecutive failures", () => {
    const first = nextCheckAt(
      { now: NOW, consecutiveFailures: 0 },
      { kind: "failure" },
    );
    const third = nextCheckAt(
      { now: NOW, consecutiveFailures: 2 },
      { kind: "failure" },
    );
    expect(third - NOW).toBeGreaterThan(first - NOW);
  });

  it("caps the backoff so a long outage cannot park renewal forever", () => {
    const capped = RENEW_RETRY_DELAYS_MS[RENEW_RETRY_DELAYS_MS.length - 1];
    expect(
      nextCheckAt(
        { now: NOW, consecutiveFailures: 50 },
        { kind: "failure" },
      ) - NOW,
    ).toBe(capped);
    expect(capped).toBeLessThanOrEqual(60_000);
  });
});

describe("shouldCheck", () => {
  it("is true at and past the deadline, false before it", () => {
    expect(shouldCheck(NOW, NOW)).toBe(true);
    expect(shouldCheck(NOW + 1, NOW)).toBe(true);
    expect(shouldCheck(NOW - 1, NOW)).toBe(false);
  });
});

describe("renewedToken", () => {
  it("returns the replacement token when the server renewed", () => {
    expect(renewedToken(response({ renewed: true, token: "new-token" }))).toBe(
      "new-token",
    );
  });

  it("is null when nothing was renewed", () => {
    expect(renewedToken(response({ renewed: false, token: "x" }))).toBeNull();
  });

  it("refuses a renewal that carries no token", () => {
    // Swapping the session for an empty credential is worse than not renewing:
    // the next request would 401 and sign the user out.
    expect(renewedToken(response({ renewed: true }))).toBeNull();
    expect(renewedToken(response({ renewed: true, token: "   " }))).toBeNull();
  });
});
