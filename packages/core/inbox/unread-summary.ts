/**
 * Cross-workspace unread inbox derivations.
 *
 * Pure: this module has NO runtime imports (no ApiClient, no React Query), so
 * mobile can import it directly — mobile runs its own fetch client and never
 * loads the core singleton. `inbox/queries.ts` re-exports these for web, which
 * is why there is exactly one copy of the logic rather than a mirror per app.
 */
import type { InboxWorkspaceUnread } from "../types";

/**
 * Whether any workspace OTHER than `currentWsId` has unread inbox items.
 * Drives the workspace-switcher dot: the active workspace's own unread is
 * already surfaced by the Inbox nav count, so it is excluded here to avoid a
 * duplicate signal.
 */
export function hasOtherWorkspaceUnread(
  summary: InboxWorkspaceUnread[],
  currentWsId: string | null | undefined,
): boolean {
  return summary.some((s) => s.workspace_id !== currentWsId && s.count > 0);
}

/**
 * Set of workspace ids that have unread inbox items. Lets the workspace
 * switcher dropdown mark WHICH workspace a pending message lives in (the
 * aggregate switcher dot only says "somewhere else"). Workspaces with a zero
 * count are excluded.
 */
export function unreadWorkspaceIds(summary: InboxWorkspaceUnread[]): Set<string> {
  return new Set(summary.filter((s) => s.count > 0).map((s) => s.workspace_id));
}
