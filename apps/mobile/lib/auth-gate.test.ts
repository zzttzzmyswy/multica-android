import { describe, expect, it } from "vitest";
import { resolveAppGate } from "./auth-gate";

const user = { id: "u1", email: "zzt18920306863@163.com" };

/**
 * Regression suite for the cold-start deep-link stranding bug.
 *
 * `app/(app)/_layout.tsx` used to gate on `user` alone. `isLoading` starts
 * `true` and `user` starts `null`, and a deep link makes expo-router mount the
 * `(app)` tree as the *initial* route — skipping `app/index.tsx`, the only
 * place that waited on `isLoading`. So the gate fired during the auth window
 * and sent a logged-in user to `/login`, which has no reverse redirect: the
 * session was valid the whole time and there was no way back except a manual
 * relaunch.
 */
describe("resolveAppGate", () => {
  it("waits instead of bouncing to login while auth is still initializing", () => {
    // The exact cold-start deep-link state: nothing loaded yet. Reporting
    // "login" here is the bug this suite exists to prevent.
    expect(resolveAppGate({ user: null, isLoading: true })).toBe("loading");
  });

  it("waits even when a user is already in the store", () => {
    // `isLoading` is only true during boot; holding the splash keeps the
    // workspace slug restore from flashing /select-workspace.
    expect(resolveAppGate({ user, isLoading: true })).toBe("loading");
  });

  it("sends a signed-out user to login once initialization has finished", () => {
    expect(resolveAppGate({ user: null, isLoading: false })).toBe("login");
  });

  it("admits a signed-in user once initialization has finished", () => {
    expect(resolveAppGate({ user, isLoading: false })).toBe("app");
  });
});
