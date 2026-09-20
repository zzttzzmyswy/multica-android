import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";
import { isSameDashboardScope } from "@/lib/usage-scope";

// Workspace usage rollups for the /usage screen (iteration 34). Two
// independent queries — per-day tokens and per-agent tokens — mirroring
// web's dashboardUsageDailyOptions / dashboardUsageByAgentOptions in
// packages/core/dashboard. Workspace is resolved server-side from the
// X-Workspace-Slug header. days, projectId and tz are part of the key so the
// 7/30 toggle, the iteration-87 project filter and a Preferences timezone
// change each refetch (and every combination stays cached independently).
//
// `tz` (iteration 169) is the viewer's zone, the same value web threads
// through packages/core/dashboard/queries.ts. The server slices every day
// bucket on it, so it belongs in the key for the same reason days does:
// changing the viewing timezone re-answers the question rather than
// re-rendering the same numbers. Leaving it out of the key would serve one
// zone's buckets under another zone's label.
//
// Every key is laid out ["dashboard", <report>, wsId, days, projectId, tz] so
// index 3 is always the range — the position `isSameDashboardScope` reads.

// The server materializes these rollups on a 5-minute cadence, so a mounted
// dashboard re-polls on that same cadence — polling faster would only re-read
// an unchanged rollup (web packages/core/dashboard/queries.ts:45-51). The
// short staleTime keeps re-entering the page honest: anything older than a
// minute refetches on mount instead of waiting out the interval.
const STALE_TIME = 60_000;
const REFETCH_INTERVAL = 5 * 60 * 1000;

/**
 * Shared contract for every dashboard rollup.
 *
 * `placeholderData` keeps the previous result mounted across a *range* change
 * so the KPI cards and charts transition in place instead of falling back to a
 * full-page skeleton. The scope guard deliberately rejects workspace, project,
 * report-kind and timezone changes — carrying data across those would briefly
 * render one scope's numbers under another scope's label (web parity, same
 * guard in packages/core/dashboard/queries.ts:53-65).
 */
function dashboardRollup<TQueryFnData, TQueryKey extends readonly unknown[]>(
  wsId: string | null,
  queryKey: TQueryKey,
  queryFn: (ctx: { signal: AbortSignal }) => Promise<TQueryFnData>,
) {
  return queryOptions<TQueryFnData, Error, TQueryFnData, TQueryKey>({
    queryKey,
    queryFn,
    enabled: !!wsId,
    staleTime: STALE_TIME,
    refetchInterval: REFETCH_INTERVAL,
    placeholderData: (previousData, previousQuery) =>
      isSameDashboardScope(previousQuery?.queryKey, queryKey)
        ? keepPreviousData(previousData)
        : undefined,
  });
}

export const dashboardUsageDailyOptions = (
  wsId: string | null,
  days: number,
  projectId: string | null,
  tz: string,
) =>
  dashboardRollup(
    wsId,
    ["dashboard", "usage-daily", wsId, days, projectId, tz] as const,
    ({ signal }) => api.getDashboardUsageDaily(days, projectId, tz, { signal }),
  );

export const dashboardUsageByAgentOptions = (
  wsId: string | null,
  days: number,
  projectId: string | null,
  tz: string,
) =>
  dashboardRollup(
    wsId,
    ["dashboard", "usage-by-agent", wsId, days, projectId, tz] as const,
    ({ signal }) => api.getDashboardUsageByAgent(days, projectId, tz, { signal }),
  );

// Dashboard failure rollups for the Errors tab (iteration 44). Same contract
// as the usage rollups above: days + projectId + tz part of the key so the
// range toggle, project filter and timezone change refetch and each
// combination stays cached.
export const dashboardFailuresDailyOptions = (
  wsId: string | null,
  days: number,
  projectId: string | null,
  tz: string,
) =>
  dashboardRollup(
    wsId,
    ["dashboard", "failures-daily", wsId, days, projectId, tz] as const,
    ({ signal }) => api.getDashboardFailuresDaily(days, projectId, tz, { signal }),
  );

export const dashboardFailuresByAgentOptions = (
  wsId: string | null,
  days: number,
  projectId: string | null,
  tz: string,
) =>
  dashboardRollup(
    wsId,
    ["dashboard", "failures-by-agent", wsId, days, projectId, tz] as const,
    ({ signal }) => api.getDashboardFailuresByAgent(days, projectId, tz, { signal }),
  );

// Dashboard run-time rollups for the Time/Tasks dimension (iteration 45).
// Same contract as the usage/failures rollups above: days + projectId + tz
// part of the key so the range toggle, project filter and timezone change
// refetch.
export const dashboardAgentRunTimeOptions = (
  wsId: string | null,
  days: number,
  projectId: string | null,
  tz: string,
) =>
  dashboardRollup(
    wsId,
    ["dashboard", "agent-runtime", wsId, days, projectId, tz] as const,
    ({ signal }) => api.getDashboardAgentRunTime(days, projectId, tz, { signal }),
  );

export const dashboardRunTimeDailyOptions = (
  wsId: string | null,
  days: number,
  projectId: string | null,
  tz: string,
) =>
  dashboardRollup(
    wsId,
    ["dashboard", "runtime-daily", wsId, days, projectId, tz] as const,
    ({ signal }) => api.getDashboardRunTimeDaily(days, projectId, tz, { signal }),
  );
