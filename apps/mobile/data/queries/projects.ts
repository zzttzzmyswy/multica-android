/**
 * Workspace project queries. Three query shapes:
 *
 *   - List       (projectKeys.list)       — `Project[]`
 *   - Detail     (projectKeys.detail)     — `Project`
 *   - Resources  (projectKeys.resources)  — `ProjectResource[]` (per project)
 *
 * Detail and Resources are workspace-scoped via the `wsId` segment so
 * switching workspaces flips the cache without manual invalidate, per the
 * root CLAUDE.md "Workspace-scoped queries must key on wsId" rule.
 *
 * Issues belonging to a project are NOT a project query — they live under
 * `issueKeys.list(wsId, { project_id })` and reuse the issues cache shape.
 * See `projectIssuesOptions` below for the binding helper.
 */
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { Project } from "@multica/core/types";
import { api } from "@/data/api";
import {
  issueKeys,
  issueParamsKey,
  type IssueListWindowParams,
} from "@/data/queries/issue-keys";
import {
  ISSUE_PAGE_SIZE,
  makeIssuePage,
  nextIssuePageParam,
} from "@/lib/issue-pagination";

export const projectKeys = {
  all: (wsId: string | null) => ["projects", wsId] as const,
  list: (wsId: string | null) => [...projectKeys.all(wsId), "list"] as const,
  detail: (wsId: string | null, id: string) =>
    [...projectKeys.all(wsId), "detail", id] as const,
  resources: (wsId: string | null, id: string) =>
    [...projectKeys.all(wsId), "detail", id, "resources"] as const,
};

export const projectListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: projectKeys.list(wsId),
    queryFn: async ({ signal }) => {
      const res = await api.listProjects({ signal });
      return res.projects;
    },
    enabled: !!wsId,
  });

export const projectDetailOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: projectKeys.detail(wsId, id),
    queryFn: ({ signal }) => api.getProject(id, { signal }),
    enabled: !!wsId && !!id,
  });

export const projectResourcesOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: projectKeys.resources(wsId, id),
    queryFn: async ({ signal }) => {
      const res = await api.listProjectResources(id, { signal });
      return res.resources;
    },
    enabled: !!wsId && !!id,
  });

/**
 * Issues filtered by `project_id`. Lives under the issues cache prefix
 * (not the projects one) so a WS `issue:*` event invalidating
 * `issueKeys.list(wsId)` also refreshes this list — single source of
 * truth for issue caches. Paginated like the workspace list
 * (`InfiniteData<IssuePage>`); read it with `readIssueRows`.
 *
 * `window` (MYS-2066) carries this surface's server-side narrowing. It used to
 * take none: the project page's filters were applied purely client-side, which
 * is only equivalent while a project fits in one page — and measured on the
 * deployment, four of twelve projects hold more than 100 issues (432 at the
 * top), so 「显示子任务」 off hid the sub-issues that happened to be in the
 * loaded page rather than all of them. The window rides IN the key (suffix,
 * mirroring `myWindowSuffix`) so each narrowing keeps its own cache entry.
 *
 * The key stays under the `[…, "byProject", projectId]` prefix whether or not a
 * window is present, which is what lets the realtime patcher reach every window
 * variant of one project with a single prefix match.
 */
export const projectIssuesOptions = (
  wsId: string | null,
  projectId: string,
  window: IssueListWindowParams = {},
) => {
  const key: unknown[] = [...issueKeys.list(wsId), "byProject", projectId];
  // Same rule as the other two surfaces: a bag with no active dimension keeps
  // the historical key shape, so nothing that already reads it needs updating.
  if (Object.keys(window).length > 0) key.push(`w:${issueParamsKey(window)}`);
  return infiniteQueryOptions({
    queryKey: key,
    queryFn: async ({ pageParam, signal }) => {
      const res = await api.listIssues(
        {
          project_id: projectId,
          ...window,
          limit: ISSUE_PAGE_SIZE,
          offset: pageParam,
        },
        { signal },
      );
      return makeIssuePage(res.issues, res.total);
    },
    initialPageParam: 0,
    getNextPageParam: (_lastPage, allPages) => nextIssuePageParam(allPages),
    enabled: !!wsId && !!projectId,
  });
};

/**
 * Helper for the read-only project chip — returns the project matching id,
 * or undefined. Caller selects from the list query and looks up by id.
 */
export function findProject(
  projects: Project[],
  id: string | null,
): Project | undefined {
  if (!id) return undefined;
  return projects.find((p) => p.id === id);
}
