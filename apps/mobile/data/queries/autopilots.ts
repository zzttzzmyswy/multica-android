/**
 * Autopilot query key factory + options. Mirrors web
 * `packages/core/autopilots/queries.ts` — `["autopilots", wsId, "list"]`,
 * `["autopilots", wsId, "detail", id]`, `["autopilots", wsId, "runs", id]`.
 * Cross-platform mental-model parity: a reader switching between mobile and
 * web finds the same key shape. Every queryFn forwards the TanStack Query
 * signal so stale/inactive queries cancel on navigate-away.
 */
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const autopilotKeys = {
  all: (wsId: string | null) => ["autopilots", wsId] as const,
  list: (wsId: string | null) => [...autopilotKeys.all(wsId), "list"] as const,
  detail: (wsId: string | null, id: string) =>
    [...autopilotKeys.all(wsId), "detail", id] as const,
  runs: (wsId: string | null, id: string) =>
    [...autopilotKeys.all(wsId), "runs", id] as const,
  deliveries: (wsId: string | null, id: string) =>
    [...autopilotKeys.all(wsId), "deliveries", id] as const,
};

export const autopilotListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: autopilotKeys.list(wsId),
    queryFn: ({ signal }) => api.listAutopilots(undefined, { signal }),
    select: (data) => data.autopilots,
    enabled: !!wsId,
  });

export const autopilotDetailOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: autopilotKeys.detail(wsId, id),
    queryFn: ({ signal }) => api.getAutopilot(id, { signal }),
    enabled: !!wsId && !!id,
  });

export const autopilotRunsOptions = (
  wsId: string | null,
  id: string,
  options?: { limit?: number },
) =>
  queryOptions({
    queryKey: autopilotKeys.runs(wsId, id),
    queryFn: ({ signal }) =>
      api.listAutopilotRuns(id, { limit: options?.limit }, { signal }),
    select: (data) => data.runs,
    enabled: !!wsId && !!id,
  });

export const autopilotDeliveriesOptions = (
  wsId: string | null,
  id: string,
  options?: { limit?: number; enabled?: boolean },
) =>
  queryOptions({
    queryKey: autopilotKeys.deliveries(wsId, id),
    queryFn: ({ signal }) =>
      api.listAutopilotDeliveries(
        id,
        { limit: options?.limit ?? 20 },
        { signal },
      ),
    select: (data) => data.deliveries,
    enabled: !!wsId && !!id && options?.enabled !== false,
  });