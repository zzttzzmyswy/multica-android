import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

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
export const dashboardUsageDailyOptions = (
  wsId: string | null,
  days: number,
  projectId: string | null,
  tz: string,
) =>
  queryOptions({
    queryKey: ["dashboard", "usage-daily", wsId, days, projectId, tz] as const,
    queryFn: ({ signal }) =>
      api.getDashboardUsageDaily(days, projectId, tz, { signal }),
    enabled: !!wsId,
    staleTime: 60_000,
  });

export const dashboardUsageByAgentOptions = (
  wsId: string | null,
  days: number,
  projectId: string | null,
  tz: string,
) =>
  queryOptions({
    queryKey: ["dashboard", "usage-by-agent", wsId, days, projectId, tz] as const,
    queryFn: ({ signal }) =>
      api.getDashboardUsageByAgent(days, projectId, tz, { signal }),
    enabled: !!wsId,
    staleTime: 60_000,
  });

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
  queryOptions({
    queryKey: ["dashboard", "failures-daily", wsId, days, projectId, tz] as const,
    queryFn: ({ signal }) =>
      api.getDashboardFailuresDaily(days, projectId, tz, { signal }),
    enabled: !!wsId,
    staleTime: 60_000,
  });

export const dashboardFailuresByAgentOptions = (
  wsId: string | null,
  days: number,
  projectId: string | null,
  tz: string,
) =>
  queryOptions({
    queryKey: ["dashboard", "failures-by-agent", wsId, days, projectId, tz] as const,
    queryFn: ({ signal }) =>
      api.getDashboardFailuresByAgent(days, projectId, tz, { signal }),
    enabled: !!wsId,
    staleTime: 60_000,
  });

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
  queryOptions({
    queryKey: ["dashboard", "agent-runtime", wsId, days, projectId, tz] as const,
    queryFn: ({ signal }) =>
      api.getDashboardAgentRunTime(days, projectId, tz, { signal }),
    enabled: !!wsId,
    staleTime: 60_000,
  });

export const dashboardRunTimeDailyOptions = (
  wsId: string | null,
  days: number,
  projectId: string | null,
  tz: string,
) =>
  queryOptions({
    queryKey: ["dashboard", "runtime-daily", wsId, days, projectId, tz] as const,
    queryFn: ({ signal }) =>
      api.getDashboardRunTimeDaily(days, projectId, tz, { signal }),
    enabled: !!wsId,
    staleTime: 60_000,
  });
