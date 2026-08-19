/**
 * Workspace issue-status catalog queries (MUL-6243), mirroring web's
 * `packages/core/issue-statuses/queries.ts`.
 *
 * The catalog is read by every surface that renders a status label, so it is
 * cached generously (5 min stale) and keyed workspace-scoped. The cache holds
 * the full `ListIssueStatusesResponse` envelope — the mutations patch that
 * same shape — and surfaces consume the resolved `IssueStatusCatalog` from
 * `useIssueStatuses`.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { ListIssueStatusesResponse } from "@multica/core/types";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  buildIssueStatusCatalog,
  type IssueStatusCatalog,
} from "@/lib/issue-status-catalog";

export const issueStatusKeys = {
  all: (wsId: string | null) => ["issue-statuses", wsId] as const,
  list: (wsId: string | null) =>
    [...issueStatusKeys.all(wsId), "list"] as const,
};

export function issueStatusListOptions(wsId: string | null) {
  return queryOptions({
    queryKey: issueStatusKeys.list(wsId),
    queryFn: async ({ signal }) => api.listIssueStatuses({ includeArchived: true, signal }),
    // ARCHIVED entries included on purpose. Archiving retires a status from
    // future assignment but leaves existing issues on it, and those issues
    // must keep their real name, color and category. Pickers use
    // `activeStatuses`, which excludes them. (MUL-6243)
    select: (data: ListIssueStatusesResponse) => data.statuses,
    // The catalog changes only when an admin edits it, which is rare, so a
    // generous stale time keeps this off the critical path of every render
    // that needs a status label.
    staleTime: 5 * 60_000,
    enabled: !!wsId,
  });
}

/**
 * The resolved workspace status catalog. Unloaded/errored states are folded
 * into the catalog's defensive fallbacks — built-in keys always resolve — so
 * surfaces can render with no extra branching.
 */
export function useIssueStatuses(wsId?: string | null): IssueStatusCatalog {
  const storeWsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const resolvedWsId = wsId ?? storeWsId;
  const query = useQuery(issueStatusListOptions(resolvedWsId));
  return buildIssueStatusCatalog(query.data, {
    isPending: query.isPending,
    isError: query.isError,
    retry: query.refetch,
  });
}