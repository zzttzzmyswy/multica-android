import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

// Workspace usage rollups for the /usage screen (iteration 34). Two
// independent queries — per-day tokens and per-agent tokens — mirroring
// web's dashboardUsageDailyOptions / dashboardUsageByAgentOptions in
// packages/core/dashboard. Workspace is resolved server-side from the
// X-Workspace-Slug header. days is part of the key so the 7/30 toggle
// refetches (and the previous range stays cached).
export const dashboardUsageDailyOptions = (wsId: string | null, days: number) =>
  queryOptions({
    queryKey: ["dashboard", "usage-daily", wsId, days] as const,
    queryFn: ({ signal }) => api.getDashboardUsageDaily(days, { signal }),
    enabled: !!wsId,
    staleTime: 60_000,
  });

export const dashboardUsageByAgentOptions = (wsId: string | null, days: number) =>
  queryOptions({
    queryKey: ["dashboard", "usage-by-agent", wsId, days] as const,
    queryFn: ({ signal }) => api.getDashboardUsageByAgent(days, { signal }),
    enabled: !!wsId,
    staleTime: 60_000,
  });