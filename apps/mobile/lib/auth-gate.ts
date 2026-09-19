/**
 * The one place that decides whether a route inside `(app)` may render.
 *
 * `user` alone is not enough. `useAuthStore` starts at `{ user: null,
 * isLoading: true }`, and a deep link makes expo-router mount `(app)` as the
 * *initial* route — `app/index.tsx`, the only screen that waited on
 * `isLoading`, never runs. Gating on `user` alone therefore fired during the
 * auth window and redirected a logged-in user to `/login`, which has no
 * reverse redirect: the session was valid the whole time and only a manual
 * relaunch recovered it (MYS-1202).
 *
 * Kept as a pure function because the mobile vitest lane is Node-only — it
 * ships no RN renderer, so a rule this easy to get wrong has to live somewhere
 * a test can reach it.
 */
export type AppGateDecision = "loading" | "login" | "app";

export function resolveAppGate(state: {
  user: unknown;
  isLoading: boolean;
}): AppGateDecision {
  if (state.isLoading) return "loading";
  return state.user ? "app" : "login";
}
