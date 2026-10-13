import type { IssuePriority, IssueStatus } from "./issue";

export type InboxSeverity = "action_required" | "attention" | "info";

export type InboxItemType =
  | "issue_assigned"
  | "issue_subscribed"
  | "unassigned"
  | "assignee_changed"
  | "status_changed"
  | "priority_changed"
  | "start_date_changed"
  | "due_date_changed"
  | "new_comment"
  | "mentioned"
  | "review_requested"
  | "task_completed"
  | "task_failed"
  | "agent_blocked"
  | "agent_completed"
  | "reaction_added"
  | "quick_create_done"
  | "quick_create_failed"
  // Quick create whose outcome could not be verified. Distinct from
  // quick_create_failed because it must NOT be rendered with failure framing:
  // the issue may actually have been created.
  | "quick_create_unconfirmed"
  // System notifications, which are intentionally issue-less — they are also
  // the only notifications with no `issue_status` and no `issue_priority`,
  // which is why the archive's facet counts come up short of its row count
  // without them. Present on the wire (observed live in the archived inbox)
  // but missing from this union until iteration 238, so `typeLabel` in the
  // mobile app had no key to resolve and rendered the raw id
  // ("inbox.type.autopilot_paused") on screen.
  | "autopilot_paused"
  | "autopilot_quota_exceeded"
  // Sub-issues of an issue assigned to the recipient closed (the child_done
  // system rule notifies a member assignee instead of waking an agent).
  | "children_done";

/**
 * One workspace's unread inbox count in the cross-workspace summary
 * (`GET /api/inbox/unread-summary`). The sidebar uses this to light a dot on
 * the workspace switcher when a workspace OTHER than the active one has
 * unread items.
 */
export interface InboxWorkspaceUnread {
  workspace_id: string;
  count: number;
}

export interface InboxItem {
  id: string;
  workspace_id: string;
  recipient_type: "member" | "agent";
  recipient_id: string;
  actor_type: "member" | "agent" | "system" | null;
  actor_id: string | null;
  type: InboxItemType;
  severity: InboxSeverity;
  issue_id: string | null;
  title: string;
  body: string | null;
  issue_status: IssueStatus | null;
  /**
   * Current priority of the linked issue, projected alongside `issue_status`.
   * Optional, not required: a build shipped against a server that predates
   * this projection must still parse, and `null` covers both "no linked
   * issue" and "server omits the column" without inventing a priority the
   * issue does not have.
   */
  issue_priority?: IssuePriority | null;
  read: boolean;
  archived: boolean;
  created_at: string;
  details: Record<string, string> | null;
}

/**
 * One page of the archived inbox (`GET /api/inbox/archived/page`).
 *
 * `nextCursor` is opaque and server-minted — the client only ever hands it
 * back verbatim. `hasMore` is redundant with `nextCursor !== null` by
 * contract, and the schema enforces that agreement rather than trusting it:
 * a page claiming more with no cursor to fetch it would render a "load more"
 * that can never load, and a page claiming the end while carrying a cursor
 * would silently truncate the archive — the exact failure this endpoint
 * exists to fix.
 */
export interface ArchivedInboxPage {
  items: InboxItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Counts for the archived view's filter menu (`GET /api/inbox/archived/facets`).
 *
 * Each number is the row count a selection would actually reveal: the server
 * computes every dimension against the OTHER active dimensions while ignoring
 * its own, so a count never promises rows another active filter excludes.
 * `unreadCount` is the `unreadOnly` toggle's count, on the same footing.
 */
export interface ArchivedInboxFacets {
  statuses: Record<string, number>;
  priorities: Record<string, number>;
  /** Actor keys — `inboxActorKey` in `packages/core/inbox/filter-store.ts`. */
  actors: Record<string, number>;
  unreadCount: number;
}
