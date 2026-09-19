import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";
import { resolveRuntimeModelsMobile } from "@/lib/runtime-models-poll";

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

// Runtime model catalog (iteration-121 agent-create model picker). Mobile
// mirror of web packages/core/runtimes/models.ts runtimeModelsOptions: the
// catalog is a live daemon round trip (POST initiates, GET /:requestId polls —
// see lib/runtime-models-poll.ts), so it is only queried for a selected
// runtime and never retried — a failed discovery degrades the form to manual
// entry instead of spinning. The result is held briefly so re-opening the
// picker inside one form session reuses it; the catalog only changes when the
// runtime's CLI / provider config changes.
const RUNTIME_MODELS_STALE_TIME_MS = 5 * 60_000;
const RUNTIME_MODELS_GC_TIME_MS = 30 * 60_000;

export const runtimeModelsOptions = (runtimeId: string | null | undefined) =>
  queryOptions({
    queryKey: ["runtimes", "models", runtimeId ?? ""] as const,
    queryFn: () =>
      resolveRuntimeModelsMobile(runtimeId as string, {
        initiate: () => api.initiateListModels(runtimeId as string),
        poll: (requestId: string) =>
          api.getListModelsResult(runtimeId as string, requestId),
      }),
    enabled: !!runtimeId,
    staleTime: RUNTIME_MODELS_STALE_TIME_MS,
    gcTime: RUNTIME_MODELS_GC_TIME_MS,
    retry: false,
  });
