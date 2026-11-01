/**
 * Sliding session renewal — the decision half (MYS-2538).
 *
 * The token this app stores is a 90-day credential
 * (`server/internal/handler/personal_access_token.go`: `PATRenewExtension`).
 * Nothing in the app renewed it, and `auth-store` clears the token on any 401,
 * so a session simply died on day 90 and the user was signed out mid-use with
 * no way to tell why. The server has a renewal endpoint
 * (`POST /api/auth/refresh`) that was already deployed and never called.
 *
 * Renewal follows USE, not a clock:
 *
 *   - a check runs at launch and whenever the app returns to the foreground,
 *     plus on user interaction (any touch);
 *   - there is deliberately NO background timer. A phone in a pocket is the
 *     normal state of a phone, and a timer would keep a session alive for
 *     someone who stopped using the app months ago.
 *
 * The server decides when a check is worth it: it answers
 * `check_again_in_seconds` and `renewed`. This module owns only the client-side
 * gate — how long to wait before asking again — and it distinguishes two waits
 * that must not share a number:
 *
 *   - after a SUCCESS, wait the server's cadence (it can be days);
 *   - after a FAILURE, wait a short backoff. Sharing the success cadence with
 *     failures is fatal in the ordinary case: a client told "check again in 3
 *     days" on day 12, returning on day 29 with one day left and hitting a
 *     single 503, would not be allowed to retry until day 32 — two days after
 *     the session expired.
 *
 * Pure functions only, so the policy is exercised in the Node lane; the
 * Keychain/network wiring lives in `session-renewal.ts`.
 */

/** How long to wait after a FAILED check, by consecutive failure. Mirrors
 *  `RETRY_DELAYS_MS` in the server's own renewal contract. */
export const RENEW_RETRY_DELAYS_MS = [
  1_000, 2_000, 4_000, 8_000, 16_000, 30_000,
] as const;

/** Anti-busy-loop floor, not a policy. It matches the server's own floor so it
 *  never overrides a cadence the server actually chose — a floor above the
 *  server's smallest value would silently let an active session expire. */
export const MIN_CHECK_INTERVAL_MS = 5_000;

/** What the renewal endpoint answers (`RefreshSessionResponse` upstream). */
export interface RenewalResponse {
  /** The replacement token. Present only when `renewed`. */
  token?: string;
  /** New absolute expiry, ISO-8601. */
  expires_at?: string;
  /** False means "nothing to do yet" — the session is not inside its renewal
   *  window. Not an error. */
  renewed: boolean;
  /** How long until another check may be useful. */
  check_again_in_seconds: number;
}

export interface RenewalClock {
  now: number;
  consecutiveFailures: number;
}

/**
 * When may the next check run?
 *
 * Returns an absolute timestamp. A success uses the server's cadence, clamped
 * up to the anti-busy-loop floor; a failure uses the short backoff so a bad
 * minute cannot consume a multi-day window.
 */
export function nextCheckAt(
  clock: RenewalClock,
  outcome: { kind: "success"; response: RenewalResponse } | { kind: "failure" },
): number {
  if (outcome.kind === "failure") {
    const delay =
      RENEW_RETRY_DELAYS_MS[
        Math.min(clock.consecutiveFailures, RENEW_RETRY_DELAYS_MS.length - 1)
      ]!;
    return clock.now + delay;
  }
  const seconds = outcome.response.check_again_in_seconds;
  // A response that omits the cadence (older server, or a malformed body that
  // fell back to defaults) must not authorise a check on every foreground
  // transition. Fall back to the server's floor.
  const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  return clock.now + Math.max(ms, MIN_CHECK_INTERVAL_MS);
}

/** Should a check run now? */
export function shouldCheck(now: number, nextAllowedAt: number): boolean {
  return now >= nextAllowedAt;
}

/**
 * Does a successful response actually give us a usable replacement?
 *
 * A `renewed: true` with no token would otherwise swap the session for
 * nothing — worse than not renewing. Treated as "nothing to do", so the
 * caller keeps the current session.
 */
export function renewedToken(response: RenewalResponse): string | null {
  if (!response.renewed) return null;
  const token = response.token?.trim();
  return token ? token : null;
}
