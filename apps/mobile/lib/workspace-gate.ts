/**
 * The one place that decides whether the children of `[workspace]/_layout` may
 * render. See `workspace-gate.test.ts` for why the second window exists.
 *
 * `currentWorkspaceId` is written by the layout's own post-paint effect, so it
 * lags the workspaces list by one commit. Without this gate the children mount
 * in that commit, and any screen that reads the id from the store and gates
 * only on its query's `isLoading` renders its terminal not-found branch — the
 * query is `enabled: false` while the id is null, which React Query reports as
 * `isLoading === false`.
 */
export type WorkspaceGateDecision = "loading" | "redirect" | "ready";

export function resolveWorkspaceGate(state: {
  isLoading: boolean;
  matchedId: string | null;
  currentWorkspaceId: string | null;
}): WorkspaceGateDecision {
  if (state.isLoading) return "loading";
  if (!state.matchedId) return "redirect";
  // A mismatched id is not ready either: it means the store still points at a
  // previously active workspace, and the queries would run against it.
  if (state.currentWorkspaceId !== state.matchedId) return "loading";
  return "ready";
}
