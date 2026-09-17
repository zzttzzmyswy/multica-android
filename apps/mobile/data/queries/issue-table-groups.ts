/**
 * Server-authoritative group counts for the mobile issue Table (MYS-1178).
 *
 * The table segments its loaded window locally, so a group header counts only
 * the rows paged in so far. Web reads `descriptor.count` off the server's
 * group descriptors instead. This module is the mobile equivalent: one
 * `POST /api/issues/table/groups` per (scope, window, grouping), reduced to a
 * `group key → count` map the table looks its headers up in.
 *
 * Pure spec/key logic lives in `lib/issue-table-group-counts.ts`.
 */
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import type { IssueTableScope } from "@multica/core/types";
import { api } from "@/data/api";
import {
  buildIssueTableGroupQuerySpec,
  issueTableGroupSpecFor,
  serverGroupCountMap,
} from "@/lib/issue-table-group-counts";
import type { IssueTableGrouping } from "@/lib/issue-table-groups";
import { issueKeys, issueParamsKey, type IssueListWindowParams } from "./issue-keys";

/** The scope + filter window a table surface is showing. Both are already on
 *  hand at every `IssueTableView` call site. */
export interface IssueTableGroupCountQuery {
  scope: IssueTableScope;
  window: IssueListWindowParams;
  /** The surface's "show sub-issues" toggle. */
  includeSubIssues: boolean;
}

/** Server pages group descriptors at 100; the count map only needs the
 *  descriptors, and no realistic workspace has more than 100 statuses,
 *  assignees or property options. A workspace that does keeps local counts
 *  for the groups past the first page — see `useIssueTableGroupCounts`. */
const GROUP_PAGE_LIMIT = 100;

export function issueTableGroupCountsOptions(
  wsId: string | null,
  query: IssueTableGroupCountQuery,
  grouping: IssueTableGrouping,
) {
  // Sort is not part of the key: `buildIssueTableGroupQuerySpec` drops it, so
  // re-sorting the table does not refetch counts that cannot have changed.
  const spec = buildIssueTableGroupQuerySpec(
    query.scope,
    query.window,
    query.includeSubIssues,
  );
  return queryOptions({
    queryKey: [
      ...issueKeys.all(wsId),
      "table-groups",
      grouping,
      JSON.stringify(query.scope),
      issueParamsKey(spec.filters),
    ] as const,
    queryFn: async ({ signal }) => {
      const group = issueTableGroupSpecFor(grouping);
      if (!group) return new Map<string, number>();
      const res = await api.listIssueTableGroups(
        { query: spec, group, page: { limit: GROUP_PAGE_LIMIT } },
        { signal },
      );
      return serverGroupCountMap(res.groups);
    },
    // Counts move whenever any issue does, and the map is cheap to recompute
    // from a fresh response — treat every mount as stale.
    staleTime: 0,
    // Keep the previous grouping's counts on screen while the new request is
    // in flight. Keys are namespaced per dimension (`status:` vs `assignee:`
    // vs `property:<id>:`), so a stale entry can never be read as a live one.
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/**
 * `group key → count over the complete result set`, or `undefined` while the
 * first response is in flight (and for any surface that does not pass a
 * query). The table falls back to its local count for missing keys, so a
 * failed or partial request degrades to today's behaviour rather than
 * blanking the headers.
 */
export function useIssueTableGroupCounts(
  wsId: string | null,
  query: IssueTableGroupCountQuery | null | undefined,
  grouping: IssueTableGrouping,
): ReadonlyMap<string, number> | undefined {
  const { data } = useQuery({
    ...issueTableGroupCountsOptions(
      wsId,
      query ?? {
        scope: { kind: "workspace" },
        window: {},
        includeSubIssues: true,
      },
      grouping,
    ),
    enabled: !!wsId && !!query && issueTableGroupSpecFor(grouping) !== null,
  });
  return data;
}
