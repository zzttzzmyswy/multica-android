/**
 * "My Issues" list, server-filtered by scope. Mirrors the three scopes web
 * exposes in `packages/views/my-issues/components/my-issues-page.tsx:48-65`:
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
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";
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
  return queryOptions({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const res = await api.listIssues({ ...filter, ...window }, { signal });
      return res.issues;
    },
    enabled: !!wsId,
  });
};