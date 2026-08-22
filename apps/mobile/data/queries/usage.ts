import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

// Workspace usage rollups for the /usage screen (iteration 34). Two
// independent queries — per-day tokens and per-agent tokens — mirroring
// web's dashboardUsageDailyOptions / dashboardUsageByAgentOptions in
// packages/core/dashboard. Workspace is resolved server-side from the
// X-Workspace-Slug header. days and projectId are part of the key so the
// 7/30 toggle and the iteration-87 project filter each refetch (and every
// (days, project) combination stays cached independently).
export const dashboardUsageDailyOptions = (
  wsId: string | null,
  days: number,
  projectId: string | null = null,
) =>
  queryOptions({
    queryKey: ["dashboard", "usage-daily", wsId, days, projectId] as const,
    queryFn: ({ signal }) => api.getDashboardUsageDaily(days, projectId, { signal }),
    enabled: !!wsId,
    staleTime: 60_000,
  });

export const dashboardUsageByAgentOptions = (
  wsId: string | null,
  days: number,
  projectId: string | null = null,
) =>
  queryOptions({
    queryKey: ["dashboard", "usage-by-agent", wsId, days, projectId] as const,
    queryFn: ({ signal }) => api.getDashboardUsageByAgent(days, projectId, { signal }),
    enabled: !!wsId,
    staleTime: 60_000,
  });

// Dashboard failure rollups for the Errors tab (iteration 44). Same contract
// as the usage rollups above: days + projectId part of the key so the range
// toggle and project filter refetch and each combination stays cached.
export const dashboardFailuresDailyOptions = (
  wsId: string | null,
  days: number,
  projectId: string | null = null,
) =>
  queryOptions({
    queryKey: ["dashboard", "failures-daily", wsId, days, projectId] as const,
    queryFn: ({ signal }) => api.getDashboardFailuresDaily(days, projectId, { signal }),
    enabled: !!wsId,
    staleTime: 60_000,
  });

export const dashboardFailuresByAgentOptions = (
  wsId: string | null,
  days: number,
  projectId: string | null = null,
) =>
  queryOptions({
    queryKey: ["dashboard", "failures-by-agent", wsId, days, projectId] as const,
    queryFn: ({ signal }) =>
      api.getDashboardFailuresByAgent(days, projectId, { signal }),
    enabled: !!wsId,
    staleTime: 60_000,
  });

// Dashboard run-time rollups for the Time/Tasks dimension (iteration 45).
// Same contract as the usage/failures rollups above: days + projectId part of
// the key so the range toggle and project filter refetch.
export const dashboardAgentRunTimeOptions = (
  wsId: string | null,
  days: number,
  projectId: string | null = null,
) =>
  queryOptions({
    queryKey: ["dashboard", "agent-runtime", wsId, days, projectId] as const,
    queryFn: ({ signal }) => api.getDashboardAgentRunTime(days, projectId, { signal }),
    enabled: !!wsId,
    staleTime: 60_000,
  });

export const dashboardRunTimeDailyOptions = (
  wsId: string | null,
  days: number,
  projectId: string | null = null,
) =>
  queryOptions({
    queryKey: ["dashboard", "runtime-daily", wsId, days, projectId] as const,
    queryFn: ({ signal }) => api.getDashboardRunTimeDaily(days, projectId, { signal }),
    enabled: !!wsId,
    staleTime: 60_000,
  });
