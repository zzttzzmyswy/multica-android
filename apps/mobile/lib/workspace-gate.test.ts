import { describe, expect, it } from "vitest";
import { resolveWorkspaceGate } from "./workspace-gate";

/**
 * The workspace layout is the single gate every `[workspace]/...` screen sits
 * behind, and it has two asynchronous windows, not one.
 *
 * The first — the workspaces list itself — was already handled. The second was
 * not, and the 142 round's runtime-machine track scan is what surfaced it:
 * `currentWorkspaceId` is written by a *post-paint* effect (`setCurrentWorkspace`
 * in the layout), so on the commit where the list arrives the children mount
 * one frame early with `currentWorkspaceId === null`. Every screen that reads
 * the id from the store and gates only on its query's `isLoading` then renders
 * its terminal not-found branch: `runtimeListOptions(null)` is `enabled: false`,
 * so React Query reports `isPending && !isFetching` → `isLoading === false`,
 * the row is not found, and the user sees 找不到该机器 before the data lands.
 *
 * Nine screens share that shape (issue, project, label, property, runtime,
 * runtime machine, skill, squad, workspace settings). Fixing the gate rather
 * than the nine call sites is what makes the window impossible instead of
 * unlikely, and it mirrors how `auth-gate.ts` closes the auth window one level
 * up. Kept pure because the mobile vitest lane is Node-only — it ships no RN
 * renderer, so a rule this easy to get wrong has to live where a test can reach
 * it.
 */
describe("workspace gate: the slug is resolved and the store has caught up", () => {
  it("waits while the workspaces list is still loading", () => {
    expect(
      resolveWorkspaceGate({
        isLoading: true,
        matchedId: null,
        currentWorkspaceId: null,
      }),
    ).toBe("loading");
  });

  it("waits while the matched workspace's id has not reached the store yet", () => {
    // The bug: the list is in, the slug matches, but the layout's effect has
    // not run, so the store still reads null. Rendering children here is what
    // painted the not-found state.
    expect(
      resolveWorkspaceGate({
        isLoading: false,
        matchedId: "ws-1",
        currentWorkspaceId: null,
      }),
    ).toBe("loading");
  });

  it("does not mistake a stale id from a previously active workspace for ready", () => {
    // Switching workspaces deep-links to a different slug while the store still
    // holds the previous id; the queries would run against the wrong workspace.
    expect(
      resolveWorkspaceGate({
        isLoading: false,
        matchedId: "ws-2",
        currentWorkspaceId: "ws-1",
      }),
    ).toBe("loading");
  });

  it("redirects when the slug matches no workspace the user belongs to", () => {
    // Covers stale persisted slugs after losing membership, and deep links to
    // a workspace that was never theirs.
    expect(
      resolveWorkspaceGate({
        isLoading: false,
        matchedId: null,
        currentWorkspaceId: null,
      }),
    ).toBe("redirect");
  });

  it("is ready once the store carries the matched id", () => {
    expect(
      resolveWorkspaceGate({
        isLoading: false,
        matchedId: "ws-1",
        currentWorkspaceId: "ws-1",
      }),
    ).toBe("ready");
  });

  it("prefers waiting over redirecting, so a cold deep link is not bounced away", () => {
    // Both windows are open at once on a cold start; the redirect must not win.
    expect(
      resolveWorkspaceGate({
        isLoading: true,
        matchedId: null,
        currentWorkspaceId: null,
      }),
    ).not.toBe("redirect");
  });
});
