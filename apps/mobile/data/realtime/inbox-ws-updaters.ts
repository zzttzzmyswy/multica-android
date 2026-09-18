/**
 * Mobile inbox cache patchers. Mirrors `packages/core/inbox/ws-updaters.ts`
 * (per CLAUDE.md "Mobile-owned updaters" — copy the design, don't import:
 * key factory binding + cache shape can drift independently).
 *
 * Two cross-cutting events that change inbox state without firing an
 * `inbox:*` event:
 *   - `issue:updated` carrying a new status → the inbox row's StatusIcon
 *     must update inline. Without this patch the row keeps showing the
 *     prior status until the next inbox event triggers a full refetch.
 *   - `issue:deleted` → all inbox items pointing at that issue are gone
 *     server-side (FK ON DELETE CASCADE in the DB); the cache should drop
 *     them too, otherwise tapping an inbox row navigates to a 404 issue.
 *
 * Both patch the MAIN and ARCHIVED lists — archived rows render the same
 * status icon and reference the same issues (mirrors packages/core/inbox/
 * ws-updaters.ts). Listing-level only; use-inbox-realtime wires these into
 * the WS layer.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { InboxItem, IssueStatus } from "@multica/core/types";
import { inboxKeys } from "@/data/queries/inbox";

export function patchInboxIssueStatus(
  qc: QueryClient,
  wsId: string,
  issueId: string,
  status: IssueStatus,
) {
  const patch = (old: InboxItem[] | undefined) =>
    old?.map((i) =>
      i.issue_id === issueId ? { ...i, issue_status: status } : i,
    );
  qc.setQueryData<InboxItem[]>(inboxKeys.list(wsId), patch);
  qc.setQueryData<InboxItem[]>(inboxKeys.archived(wsId), patch);
}

export function dropInboxItemsByIssue(
  qc: QueryClient,
  wsId: string,
  issueId: string,
) {
  const drop = (old: InboxItem[] | undefined) =>
    old?.filter((i) => i.issue_id !== issueId);
  qc.setQueryData<InboxItem[]>(inboxKeys.list(wsId), drop);
  qc.setQueryData<InboxItem[]>(inboxKeys.archived(wsId), drop);
}

/**
 * Refresh the cross-workspace unread summary (workspace-switcher dot).
 *
 * Separate from the workspace-scoped list invalidation above because the
 * summary spans EVERY workspace, so it is invalidated on any inbox event
 * regardless of which workspace the event came from — including read/archive
 * events, which the list invalidation alone would leave the dot stale for.
 * Mirrors web's `onInboxSummaryInvalidate`
 * (packages/core/inbox/ws-updaters.ts:71).
 *
 * Note the socket is bound to the ACTIVE workspace, so events raised in
 * another workspace never reach this hook. That gap is covered by the query's
 * own freshness (mobile's 60s staleTime + refetchOnWindowFocus), which is why
 * no extra polling is needed here.
 */
export function invalidateInboxSummary(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: inboxKeys.unreadSummary() });
}
