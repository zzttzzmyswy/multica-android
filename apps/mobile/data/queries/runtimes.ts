import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

// Runtime list — workspace-scoped. Feeds the availability dimension of the
// presence dot via @multica/core/agents/derive-presence (status + last_seen_at).
// Invalidated by daemon:register / sweeper-driven status changes; see
// data/realtime/use-presence-realtime.ts.
export const runtimeListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: ["runtimes", wsId] as const,
    queryFn: ({ signal }) => api.listRuntimes({ signal }),
    enabled: !!wsId,
  });

// Runtime-level usage (iteration-93 runtime detail usage section). Mirrors
// web packages/core/runtimes/queries.ts runtimeUsageOptions /
// runtimeUsageByAgentOptions — `tz` is the viewer's IANA name; every report
// follows the viewer's tz so the calendar-day boundary matches the server.
// days + tz are part of the key so the 7/30 range toggle refetches and each
// (days, tz) combination stays cached independently.
export const runtimeUsageOptions = (
  runtimeId: string | null,
  days: number,
  tz: string,
) =>
  queryOptions({
    queryKey: ["runtimes", "usage", runtimeId, days, tz] as const,
    queryFn: ({ signal }) =>
      api.getRuntimeUsage(runtimeId ?? "", { days, tz }, { signal }),
    enabled: !!runtimeId,
    staleTime: 60_000,
  });

export const runtimeUsageByAgentOptions = (
  runtimeId: string | null,
  days: number,
  tz: string,
) =>
  queryOptions({
    queryKey: ["runtimes", "usage", "by-agent", runtimeId, days, tz] as const,
    queryFn: ({ signal }) =>
      api.getRuntimeUsageByAgent(runtimeId ?? "", { days, tz }, { signal }),
    enabled: !!runtimeId,
    staleTime: 60_000,
  });
