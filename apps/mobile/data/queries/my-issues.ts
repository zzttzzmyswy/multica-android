/**
 * "My Issues" list, server-filtered by scope. Mirrors the scopes web exposes
 * in `packages/views/my-issues/components/my-issues-header.tsx:89-94`:
 *   - all:      every issue in the workspace (no relation param at all) —
 *               web's `case "all"` in core's surface/query-plan.ts:52-55
 *               returns an empty `queryFilter`, so the list is the plain
 *               workspace list
 *   - assigned: issues where assignee_id = me
 *   - created:  issues where creator_id  = me
 *   - agents:   issues where the assignee is an *indirect* extension of me —
 *               an owned agent, OR a squad I'm a human member of, lead, or
 *               have an owned agent inside. Driven server-side by the
 *               `involves_user_id` predicate (see MUL-2397, 2026-05-19).
 *               Direct member assignment is intentionally EXCLUDED — that's
 *               the `assigned` scope's meaning.
 *
 * Since iteration 62 the query also accepts a `window` bag carrying the
 * grid's filter/sort dimensions (statuses/priorities/assignee_filters/
 * creator_filters/project_ids/label_ids/sort). These travel as query
 * params alongside the scope filter; the full window is part of the cache
 * key, so changing any dimension refetches (mirrors web table windows).
 * The client re-runs `applyIssueFilters` + `sortIssues` on the result for
 * WS-patched rows — same belt-and-suspenders as the workspace list.
 *
 * Cache key shape is `issueKeys.myList(wsId, scope, filter)` (+ window
 * suffix) — same prefix as web's `packages/core/issues/queries.ts` so a
 * future WS handler can invalidate `issueKeys.myAll(wsId)` and reach both
 * clients.
 */
import { infiniteQueryOptions } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { api } from "@/data/api";
import {
  ISSUE_PAGE_SIZE,
  makeIssuePage,
  nextIssuePageParam,
} from "@/lib/issue-pagination";
import {
  issueKeys,
  issueParamsKey,
  type IssueListWindowParams,
  type MyIssuesFilter,
  type MyIssuesScope,
} from "./issue-keys";

export function buildMyIssuesFilter(
  scope: MyIssuesScope,
  userId: string,
): MyIssuesFilter {
  switch (scope) {
    case "all":
      // The list surface does NOT use this — see `myIssuesAllOptions`, which
      // scatter-gathers the three legs because the API ANDs its params. This
      // empty filter is what the GANTT projection asks for, mirroring web's
      // `case "all": return { queryFilter: {} }`
      // (packages/core/issues/surface/query-plan.ts:52-55).
      return {};
    case "assigned":
      return { assignee_id: userId };
    case "created":
      return { creator_id: userId };
    case "agents":
      return { involves_user_id: userId };
  }
}

/** Mirrors `hasWindow` in ./issues.ts — a bag with only sort_by:position
 *  asc is the default and stays out of the key. */
function myWindowSuffix(window: IssueListWindowParams): string {
  const active =
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
    (window.sort_by &&
      (window.sort_by !== "position" || window.sort_direction === "desc"));
  if (!active || Object.keys(window).length === 0) return "";
  return `w:${issueParamsKey(window)}`;
}

export const myIssueListOptions = (
  wsId: string | null,
  scope: MyIssuesScope,
  filter: MyIssuesFilter,
  window: IssueListWindowParams = {},
) => {
  const key = [...issueKeys.myList(wsId, scope, filter)];
  // Append only when the window has an active dimension — otherwise keep
  // the historical key shape so mention-suggestion + realtime share it.
  const suffix = myWindowSuffix(window);
  if (suffix) key.push(suffix);
  return infiniteQueryOptions({
    queryKey: key,
    queryFn: async ({ pageParam, signal }) => {
      const res = await api.listIssues(
        { ...filter, ...window, limit: ISSUE_PAGE_SIZE, offset: pageParam },
        { signal },
      );
      return makeIssuePage(res.issues, res.total);
    },
    initialPageParam: 0,
    getNextPageParam: (_lastPage, allPages) => nextIssuePageParam(allPages),
    enabled: !!wsId,
  });
};

/**
 * The `all` scope — the UNION of assigned / created / involved, per web's
 * `all_description` ("Assigned to me, created by me, or involving my agents
 * and squads", my-issues-header.tsx:90) and core's `my:all` membership rule
 * (packages/core/issues/surface/membership.ts:59-63).
 *
 * The legacy list API ANDs its params, so a three-way union is not one
 * request. Web gets away with `queryFilter: {}` only because its list rows
 * come from the server-owned Table channel; mobile's entire list surface IS
 * this API, and `{}` here means "the whole workspace" (measured: 1020 rows
 * against 3 assigned / 12 created / 942 involved) — not "mine".
 *
 * So: one page from each leg in parallel, merged and deduped by id (an issue
 * the user created can also be assigned to them). `fetched` deliberately sums
 * the legs' SERVER row counts, not the deduped length, because the next
 * offset indexes each leg's own window — see `IssuePage.fetched`. That also
 * keeps `nextIssuePageParam`'s `fetched < total` test correct: each leg's
 * fetched reaches its own total exactly when it runs dry, so the sum does
 * too. `total` is the summed (possibly overlap-inflated) bound; the footer's
 * "no more" decision rides on `fetched`, not on it.
 */
export const myIssuesAllOptions = (
  wsId: string | null,
  userId: string | null,
  window: IssueListWindowParams = {},
) => {
  const key = [...issueKeys.myList(wsId, "all", {})];
  const suffix = myWindowSuffix(window);
  if (suffix) key.push(suffix);
  return infiniteQueryOptions({
    queryKey: key,
    queryFn: async ({ pageParam, signal }) => {
      const legs = await Promise.all([
        api.listIssues(
          {
            assignee_id: userId as string,
            ...window,
            limit: ISSUE_PAGE_SIZE,
            offset: pageParam,
          },
          { signal },
        ),
        api.listIssues(
          {
            creator_id: userId as string,
            ...window,
            limit: ISSUE_PAGE_SIZE,
            offset: pageParam,
          },
          { signal },
        ),
        api.listIssues(
          {
            involves_user_id: userId as string,
            ...window,
            limit: ISSUE_PAGE_SIZE,
            offset: pageParam,
          },
          { signal },
        ),
      ]);

      const seen = new Set<string>();
      const merged: Issue[] = [];
      for (const leg of legs) {
        for (const issue of leg.issues) {
          if (seen.has(issue.id)) continue;
          seen.add(issue.id);
          merged.push(issue);
        }
      }
      return {
        issues: merged,
        total: legs.reduce((n, leg) => n + leg.total, 0),
        fetched: legs.reduce((n, leg) => n + leg.issues.length, 0),
      };
    },
    initialPageParam: 0,
    getNextPageParam: (_lastPage, allPages) => nextIssuePageParam(allPages),
    enabled: !!wsId && !!userId,
  });
};