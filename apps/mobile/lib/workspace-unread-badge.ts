/**
 * Workspace-switcher unread badge state.
 *
 * Two surfaces need the same answer — the switch-workspace sheet (which row
 * gets a dot) and the collapsed WorkspaceCard in the More popover (whether the
 * entry gets an aggregate dot). Composing it once here keeps the two from
 * drifting, and gives the rule a home that mobile's Node-only vitest lane can
 * actually exercise (it does not render RN components).
 *
 * The derivations come from `@multica/core/inbox/unread-summary` — shared with
 * web, not mirrored. This module adds only the mobile-side presentation rule
 * below.
 */
import {
  hasOtherWorkspaceUnread,
  unreadWorkspaceIds,
} from "@multica/core/inbox/unread-summary";
import type { InboxWorkspaceUnread } from "@multica/core/types";

export interface WorkspaceUnreadBadge {
  /** Workspace ids that should carry a per-row dot. Excludes the active one. */
  unreadIds: Set<string>;
  /** Whether the collapsed switcher entry carries the aggregate dot. */
  showAggregateDot: boolean;
}

const NONE: WorkspaceUnreadBadge = { unreadIds: new Set(), showAggregateDot: false };

/**
 * `activeWorkspaceId` is null until the workspaces query resolves. Both signals
 * stay OFF in that window rather than falling back to core's
 * `hasOtherWorkspaceUnread(summary, null)` (which counts every workspace as
 * "other"): with the active id unknown, the workspace the user is standing in
 * would be dotted — the exact duplicate signal the active-workspace exclusion
 * exists to prevent. Showing nothing for a moment beats pointing at the wrong
 * workspace.
 */
export function workspaceUnreadBadge(
  summary: InboxWorkspaceUnread[],
  activeWorkspaceId: string | null | undefined,
): WorkspaceUnreadBadge {
  if (!activeWorkspaceId) return NONE;

  const unreadIds = unreadWorkspaceIds(summary);
  unreadIds.delete(activeWorkspaceId);

  return {
    unreadIds,
    showAggregateDot: hasOtherWorkspaceUnread(summary, activeWorkspaceId),
  };
}
