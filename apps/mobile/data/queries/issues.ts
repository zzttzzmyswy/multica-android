/**
 * Issue queries — workspace-wide list, single-issue detail, timeline.
 * Mobile-owned; mirrors a strict subset of packages/core/issues/queries.ts.
 *
 * Query keys live in ./issue-keys so detail / timeline / list / myList all
 * sit under the `issues/<wsId>` prefix — WS handlers can invalidate the
 * whole subtree with one call when needed.
 */
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { api } from "@/data/api";
import { isIssueIdentifier } from "@/lib/markdown/issue-identifiers";
import {
  ISSUE_PAGE_SIZE,
  makeIssuePage,
  nextIssuePageParam,
  type IssuePage,
} from "@/lib/issue-pagination";
import {
  issueKeys,
  type IssueListWindowParams,
  type MyIssuesFilter,
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
 * PAGINATED: `GET /api/issues` clamps `limit` to 100 server-side
 * (server/internal/handler/issue.go), so a single one-shot fetch silently
 * dropped every issue past row 100 with no UI hint. The list now walks the
 * window with `limit`/`offset` pages (`ISSUE_PAGE_SIZE`) and the surface
 * renders the same four-state footer web does
 * (packages/views/issues/components/list-load-more-footer.tsx).
 *
 * Cache shape: `InfiniteData<IssuePage>` — use `readIssueRows` /
 * `mapIssueRows` (./issue-list-cache) to read or patch it, so the shared
 * WS updaters keep working against both this and the still-flat caches.
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
  infiniteQueryOptions({
    queryKey: hasWindow(window)
      ? issueKeys.listFiltered(wsId, window)
      : issueKeys.list(wsId),
    queryFn: async ({ pageParam, signal }) => {
      const res = await api.listIssues(
        { ...window, limit: ISSUE_PAGE_SIZE, offset: pageParam },
        { signal },
      );
      return makeIssuePage(res.issues, res.total);
    },
    initialPageParam: 0,
    getNextPageParam: (_lastPage, allPages) => nextIssuePageParam(allPages),
    enabled: !!wsId,
  });

/** True when the window bag holds at least one active dimension. Every
 *  field is a filter array, a date band, or a sort pair; `sort_by:
 *  "position"` with no direction is the manual default and does NOT count
 *  as a window — it round-trips the same rows as an empty bag.
 *
 *  The two server-side row narrowings (MYS-2066) belong here for the same
 *  reason every other dimension does: they change which rows the request
 *  returns, so a window carrying one must not share a key with the plain
 *  list. `ids` counts as active even when EMPTY — an empty restriction is
 *  not the unrestricted window, and keying the two together would make
 *  「智能体工作中」 on-with-nobody-running overwrite the plain list's cache
 *  entry with an empty page. */
function hasWindow(window: IssueListWindowParams): boolean {
  if (
    // Table quick search. Without this the search would still be SENT (the
    // window object carries it into `listIssues`), but the query key would be
    // the unfiltered one — so every search would overwrite the plain list's
    // cache entry and clearing it would show the previous search's rows.
    window.q ||
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
    window.date_end ||
    // Presence, not length — see the doc comment.
    window.ids != null ||
    window.top_level_only === true
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

/** Paged fetch of every scheduled issue in the workspace — the gantt
 *  canvas's data source. Mirrors web's `fetchProjectGanttIssues`
 *  (`packages/core/issues/queries.ts:358`) with `project_id` dropped: the
 *  project dimension stays a client-side filter so the same fetch serves
 *  the workspace Issues page and My Issues alike (web's gantt fetches per
 *  project because its canvas lives on the project surface; mobile's lives
 *  on workspace-wide lists). My Issues passes its scope filter (assigned /
 *  created / agents) through so the gantt honours the same server-side
 *  narrowing as the list. */
// Page size must respect the server's GET /api/issues cap (100,
// server/internal/handler/issue.go) — a larger page is silently clamped to
// 100, so the `length < pageSize` short-page check would break after the
// first page and truncate any workspace with >100 scheduled issues.
const GANTT_PAGE_LIMIT = 100;
const GANTT_MAX_ISSUES = 10_000;

export async function fetchGanttIssues(
  wsId: string,
  filter?: MyIssuesFilter,
  signal?: AbortSignal,
): Promise<Issue[]> {
  const issues: Issue[] = [];
  let offset = 0;
  while (offset < GANTT_MAX_ISSUES) {
    const res = await api.listIssues(
      {
        scheduled: true,
        limit: GANTT_PAGE_LIMIT,
        offset,
        ...filter,
      },
      { signal },
    );
    issues.push(...res.issues);
    if (res.issues.length < GANTT_PAGE_LIMIT) break;
    // `total > 0` guard: the schema defaults an absent total to 0, and a 0
    // total must not be read as "we already have everything" on a non-empty
    // first page — that would abort the walk mid-workspace.
    if (res.total != null && res.total > 0 && issues.length >= res.total) break;
    offset += GANTT_PAGE_LIMIT;
  }
  return issues;
}

/** Gantt canvas data — all scheduled issues, fetched once per workspace.
 *  Keyed under `list(wsId)` so the shared WS invalidation prefix reaches
 *  it; enabled only while the gantt view is on screen (web gates the same
 *  fetch on `usesGantt`). `filter` carries the My Issues scope (assigned /
 *  created / agents) into both the cache key and the page requests, so each
 *  scope's canvas stays a separate cache entry. */
export const ganttIssuesOptions = (
  wsId: string | null,
  enabled: boolean,
  filter?: MyIssuesFilter,
) =>
  queryOptions({
    queryKey: [
      ...issueKeys.list(wsId),
      "gantt",
      ...(filter ? ([filter] as const) : []),
    ],
    queryFn: ({ signal }) =>
      fetchGanttIssues(wsId as string, filter, signal),
    enabled: !!wsId && enabled,
  });

export const issueDetailOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: issueKeys.detail(wsId, id),
    queryFn: ({ signal }) => api.getIssue(id, { signal }),
    enabled: !!wsId && !!id,
  });

/**
 * Resolve a bare issue identifier (`MYS-2109`) to the issue it names, or
 * `null` when this workspace has no such issue.
 *
 * Backs the read-only identifier autolink (`lib/markdown/issue-identifiers.ts`):
 * the preprocessor may only rewrite an identifier it has CONFIRMED, because the
 * server 404s one that names nothing and an unconfirmed rewrite would turn an
 * innocuous string into a link to an error page.
 *
 * `enabled` gates on the workspace's own prefix as well as the identifier
 * shape, mirroring web's `useResolveIssueIdentifier`. The prefix gate is not
 * cosmetic: classifying every identifier occurrence across 40 live issues of
 * this deployment found `MYS-` at 340 of 380, with the remainder being part
 * numbers (`MT62F4G32D8DV-4`), other products' keys (`UTF-8`, `UDP-1`) and
 * other workspaces' issues — all strings the server can never resolve here.
 *
 * Fetches through `api.getIssue` rather than `api.searchIssues`: search pages
 * a title/description/comment index and can therefore miss an exact identifier
 * whose row falls outside the returned window, whereas the detail endpoint
 * resolves the identifier directly. Both were measured against this deployment
 * — the detail endpoint is also the smaller response (median 7.3 KB against
 * 17.1 KB for `limit=10`, since search returns full issue bodies).
 */
export const issueIdentifierOptions = (
  wsId: string | null,
  identifier: string,
  issuePrefix: string | null | undefined,
) =>
  queryOptions({
    queryKey: issueKeys.identifier(wsId, identifier),
    queryFn: async ({ signal }) => {
      try {
        return await api.getIssue(identifier, { signal });
      } catch {
        // A 404 is the ANSWER here, not a failure: "this workspace has no such
        // issue". Resolving to `null` lets the caller render the identifier as
        // plain text, which is the correct end state. Rethrowing would instead
        // park the query in `error` and, under the global `retry: 1`, spend a
        // second request on every genuinely-absent identifier.
        return null;
      }
    },
    enabled:
      !!wsId && isIssueIdentifier(identifier) && prefixMatches(identifier, issuePrefix),
    // An identifier→issue mapping is effectively immutable; the same identifier
    // recurs across many comments, and staleTime keeps that to one request.
    staleTime: 5 * 60_000,
  });

/**
 * Whether `identifier`'s prefix can name an issue in a workspace whose
 * `issue_prefix` is `prefix`. An unknown prefix (workspace still loading) does
 * NOT gate anything out — the lookup itself is then the authority, matching
 * web's fall-through.
 */
function prefixMatches(
  identifier: string,
  prefix: string | null | undefined,
): boolean {
  if (!prefix) return true;
  return identifier.toUpperCase().startsWith(`${prefix.toUpperCase()}-`);
}

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

/**
 * Both sides of an issue's duplicate relation (MUL-7349): the original it
 * duplicates, and the issues marked as duplicates of it.
 *
 * `refetchOnMount: "always"` for the reason core's `issueDuplicatesOptions`
 * gives (packages/core/issues/queries.ts:505): the relation is written from
 * another surface — a mark made on web, or on this phone while a different
 * issue was open — and nothing in this cache would otherwise learn about it.
 * With the global `Infinity` stale time an already-cached "no relation" would
 * survive every remount, so the banner and the section would stay missing on
 * an issue that is demonstrably a duplicate.
 */
export const issueDuplicatesOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: issueKeys.duplicates(wsId, id),
    queryFn: ({ signal }) => api.listIssueDuplicates(id, { signal }),
    enabled: !!wsId && !!id,
    refetchOnMount: "always",
  });

/**
 * What "create a sub-issue from this comment" would carry (MYS-2137).
 *
 * Keyed by the ANCHOR COMMENT, not by the issue: the preview answers "what does
 * THIS comment's thread look like right now", and two comments on the same
 * issue have two different threads and two different capture tokens.
 *
 * `staleTime: 0` is load-bearing, unlike the global `Infinity`. The response's
 * `capture_token` is a proof of what the member was shown, and the server
 * refuses the create when the source has moved on since — so a token served
 * from a cache entry created before the member walked away is a token the
 * server may well reject. Refetching on every mount is what makes the confirm
 * surface show, and then submit, the same context.
 *
 * `refetchOnMount: "always"` for the same reason: `staleTime: 0` alone still
 * lets a remount within the same tick reuse an in-flight result, and the whole
 * point here is a fresh token per confirm-surface opening.
 */
export const commentSubIssuePreviewOptions = (
  wsId: string | null,
  commentId: string,
) =>
  queryOptions({
    queryKey: issueKeys.commentSubIssuePreview(wsId, commentId),
    queryFn: ({ signal }) => api.getCommentSubIssuePreview(commentId, { signal }),
    enabled: !!wsId && !!commentId,
    staleTime: 0,
    refetchOnMount: "always",
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
