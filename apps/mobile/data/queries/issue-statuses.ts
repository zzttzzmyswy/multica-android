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
import { useMemo } from "react";
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
 *
 * MEMOIZED, and that is load-bearing rather than an optimisation. The catalog
 * carries closures (`entryOf`, `labelOf`, `categoryOf`), so an unmemoized
 * rebuild hands out a NEW function identity on every render. Anything that
 * depends on those closures then also rebuilds every render: `useStatusLabel`'s
 * `useCallback([t, entryOf])` is the one that matters here, because
 * `lib/issue-find.ts`'s haystack is memoized on the status-label resolver — an
 * unstable one would re-run the markdown walk on every keystroke, which is
 * exactly what that memo exists to prevent ("a keystroke re-runs the cheap
 * scan, not the markdown walk"). The deps below are the values the catalog is
 * actually built from, so it changes exactly when its content does.
 */
export function useIssueStatuses(wsId?: string | null): IssueStatusCatalog {
  const storeWsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const resolvedWsId = wsId ?? storeWsId;
  const query = useQuery(issueStatusListOptions(resolvedWsId));
  const { data, isPending, isError, refetch } = query;
  return useMemo(
    () =>
      buildIssueStatusCatalog(data, {
        isPending,
        isError,
        retry: refetch,
      }),
    [data, isPending, isError, refetch],
  );
}