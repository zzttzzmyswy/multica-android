/**
 * Issue queries — workspace-wide list, single-issue detail, timeline.
 * Mobile-owned; mirrors a strict subset of packages/core/issues/queries.ts.
 *
 * Query keys live in ./issue-keys so detail / timeline / list / myList all
 * sit under the `issues/<wsId>` prefix — WS handlers can invalidate the
 * whole subtree with one call when needed.
 */
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";
import {
  issueKeys,
  type IssueListWindowParams,
} from "./issue-keys";

export {
  issueKeys,
  issueParamsKey,
  type IssueListWindowParams,
} from "./issue-keys";

/**
 * Workspace-wide issue list. Backend filters by `X-Workspace-Slug` header
 * (root CLAUDE.md "All queries filter by workspace_id"), so we pass an
 * empty params object — server returns every issue the user is allowed to
 * see in the current workspace.
 *
 * Cache shape: flat `Issue[]` (we strip `.issues` from the response) so
 * the WS updaters can patch this list with the same shape as
 * myIssueListOptions. Pagination is deferred — web's `IssuesPage` also
 * fetches all in one shot today (`packages/views/issues/components/
 * issues-page.tsx:30`).
 *
 * `window` carries the view's filter/sort dimensions AS QUERY PARAMS —
 * when non-empty the query key includes the stable param bag, so changing
 * any filter/sort dimension refetches and the cache is keyed per window.
 * The client still re-runs its full predicate (`applyIssueFilters` +
 * `sortIssues`) on the result so WS-patched rows that drift outside the
 * window are filtered at render time — same belt-and-suspenders web uses
 * (server window + client predicate).
 */
export const issueListOptions = (
  wsId: string | null,
  window: IssueListWindowParams = {},
) =>
  queryOptions({
    queryKey: hasWindow(window)
      ? issueKeys.listFiltered(wsId, window)
      : issueKeys.list(wsId),
    queryFn: async ({ signal }) => {
      const res = await api.listIssues(window, { signal });
      return res.issues;
    },
    enabled: !!wsId,
  });

/** True when the window bag holds at least one active dimension. Every
 *  field is a filter array, a date band, or a sort pair; `sort_by:
 *  "position"` with no direction is the manual default and does NOT count
 *  as a window — it round-trips the same rows as an empty bag. */
function hasWindow(window: IssueListWindowParams): boolean {
  if (
    window.statuses?.length ||
    window.priorities?.length ||
    window.assignee_filters?.length ||
    window.include_no_assignee ||
    window.creator_filters?.length ||
    window.project_ids?.length ||
    window.include_no_project ||
    window.label_ids?.length ||
    (window.properties && Object.keys(window.properties).length > 0) ||
    window.date_field ||
    window.date_start ||
    window.date_end
  ) {
    return true;
  }
  if (
    window.sort_by &&
    (window.sort_by !== "position" || window.sort_direction === "desc")
  ) {
    return true;
  }
  return false;
}

export const issueDetailOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: issueKeys.detail(wsId, id),
    queryFn: ({ signal }) => api.getIssue(id, { signal }),
    enabled: !!wsId && !!id,
  });

/**
 * Single query over the full issue timeline (ASC, oldest first). Mirrors
 * web's `issueTimelineOptions` post-#2322 — server returns the whole list
 * in one shot, client-side pagination was deleted.
 */
export const issueTimelineOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: issueKeys.timeline(wsId, id),
    queryFn: ({ signal }) => api.listTimeline(id, { signal }),
    enabled: !!wsId && !!id,
  });

/**
 * Currently-running tasks for an issue. WS events (task:queued/dispatch/
 * progress/completed/failed/cancelled) patch this cache directly via
 * `issue-ws-updaters.ts`, so refetches are rare in practice. The fetch is
 * still wired so the initial open + reconnect-invalidate path works.
 */
export const issueActiveTasksOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: issueKeys.activeTasks(wsId, id),
    queryFn: ({ signal }) => api.listActiveTasksForIssue(id, { signal }),
    enabled: !!wsId && !!id,
  });

/**
 * All tasks (any status) for an issue — drives the Runs sheet history
 * section. Same patching strategy as active tasks: WS moves entries between
 * the two caches without refetching.
 */
export const issueTasksOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: issueKeys.tasks(wsId, id),
    queryFn: ({ signal }) => api.listTasksByIssue(id, { signal }),
    enabled: !!wsId && !!id,
  });

/**
 * File attachments uploaded to this issue or any of its comments. The
 * mobile markdown renderer reads this list to resolve `mc://file/<id>`
 * URIs in image markdown to a real HTTPS `download_url` that iOS can
 * actually load — see `lib/markdown/markdown-image.tsx`.
 *
 * TanStack Query dedupes the request across concurrent callers, so it's
 * safe for both IssueDescription and CommentCard to fetch the same
 * issue's attachments — only one network request fires.
 */
export const issueAttachmentsOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: issueKeys.attachments(wsId, id),
    queryFn: ({ signal }) => api.listAttachments(id, { signal }),
    enabled: !!wsId && !!id,
  });

/**
 * Direct sub-issues (children) of a parent issue — drives the sub-issue
 * section in the issue detail header. Mirrors web's `childIssuesOptions`
 * (packages/core/issues/queries.ts:458): returns an empty array when the
 * parent has no children, letting the section hide itself entirely.
 * Children are keyed under `issueKeys.children(wsId, id)` so WS activity
 * that mutates a child flips this cache via the shared invalidation surface.
 */
export const issueChildrenOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: issueKeys.children(wsId, id),
    queryFn: ({ signal }) => api.listChildIssues(id, { signal }),
    enabled: !!wsId && !!id,
  });

export type ChildProgress = { done: number; total: number };

/**
 * Workspace-wide parent→(done/total) child-progress map (MYS-493). Drives
 * the nested-progress ring on sub-issue rows — each sub-issue may itself be
 * a parent, and this query lets its row show "x/y of ITS children done"
 * without opening it. Mirrors web's `childIssueProgressOptions`
 * (packages/core/issues/queries.ts:444) including the selected shape (map
 * keyed by parent_issue_id). A shared workspace-level query is cheap: the
 * backend returns the full map in one shot, and TanStack Query dedupes it
 * across every mounted children section.
 */
export const issueChildProgressOptions = (wsId: string | null) =>
  queryOptions<{
    progress: { parent_issue_id: string; total: number; done: number }[];
  }, Error, Record<string, ChildProgress>>({
    queryKey: issueKeys.childProgress(wsId),
    queryFn: ({ signal }) => api.getChildIssueProgress(),
    enabled: !!wsId,
    select: (data) => {
      const map: Record<string, ChildProgress> = {};
      for (const entry of data.progress) {
        if (entry.total > 0) map[entry.parent_issue_id] = entry;
      }
      return map;
    },
  });

/**
 * Who is subscribed to an issue and why — drives the Subscribe control in
 * the issue detail Activity header. Mirrors web's
 * `issueSubscribersOptions` (packages/core/issues/queries.ts). The component
 * renders nothing until this resolves (`subscriptionKnown`), so an unresolved
 * query never flashes the wrong button (web MUL-5714).
 */
export const issueSubscribersOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: issueKeys.subscribers(wsId, id),
    queryFn: ({ signal }) => api.listIssueSubscribers(id, { signal }),
    enabled: !!wsId && !!id,
  });
