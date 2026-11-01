/**
 * Sliding session renewal — the wiring half (MYS-2538).
 *
 * `session-renewal-policy.ts` owns the WHEN; this module owns the WHAT: calling
 * the endpoint, committing the new token, and collapsing concurrent triggers.
 *
 * Three properties matter more than the happy path:
 *
 *   - **Renewal is not a session event.** It swaps a credential in place and
 *     must never look like a login or a logout. Offline, 5xx and a malformed
 *     response all leave the current session untouched; only a real 401 ends a
 *     session, and `auth-store`'s `onUnauthorized` already owns that.
 *   - **Concurrent triggers collapse.** Launch and a foreground transition can
 *     land together, and two renewals would leave two valid tokens racing to be
 *     the one written to the Keychain.
 *   - **No timer.** A phone in a pocket must not keep renewing a session nobody
 *     is using; the checks hang off launch, foreground and user interaction.
 */
import { api, ApiError } from "@/data/api";
import { commitRenewedToken } from "@/data/secure-storage";
import {
  nextCheckAt,
  renewedToken,
  shouldCheck,
} from "./session-renewal-policy";

let nextCheckAtMs = 0;
let consecutiveFailures = 0;
/** Collapses concurrent triggers into one request. */
let inFlight: Promise<void> | null = null;

/** Test hook: forget the schedule so a suite starts from "check immediately". */
export function __resetRenewalScheduleForTests(): void {
  nextCheckAtMs = 0;
  consecutiveFailures = 0;
  inFlight = null;
}

/**
 * Run a renewal check now, regardless of schedule. Use at launch; everywhere
 * else prefer `maybeRenewSession`.
 *
 * Never throws: a failed renewal is not something the UI can act on, and
 * surfacing it would report a session problem the reader does not have.
 */
export async function renewSessionNow(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const response = await api.refreshSession();
      consecutiveFailures = 0;
      nextCheckAtMs = nextCheckAt(
        { now: Date.now(), consecutiveFailures },
        { kind: "success", response },
      );

      const token = renewedToken(response);
      if (!token) return;
      // Commit before swapping the in-memory token: if the write fails, the app
      // keeps using the credential it already has rather than adopting one that
      // will not survive a relaunch.
      await commitRenewedToken(token);
      api.setToken(token);
      console.log("[auth] session renewed", { expiresAt: response.expires_at });
    } catch (err) {
      consecutiveFailures += 1;
      nextCheckAtMs = nextCheckAt(
        { now: Date.now(), consecutiveFailures },
        { kind: "failure" },
      );
      // A genuine 401 is the one case that ends a session, and it is not this
      // module's call — the request that got the 401 already routed it to
      // `onUnauthorized`. Everything else (offline, 5xx, malformed body) is a
      // "try again shortly" and must leave the session alone.
      const detail = err instanceof ApiError ? `status ${err.status}` : String(err);
      console.warn("[auth] session renewal deferred:", detail);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Run a renewal check only if the schedule allows one.
 *
 * Cheap enough to sit on the path of every touch: on all but one call per
 * interval this is a timestamp comparison and an early return.
 */
export function maybeRenewSession(): void {
  if (!shouldCheck(Date.now(), nextCheckAtMs)) return;
  void renewSessionNow();
}
