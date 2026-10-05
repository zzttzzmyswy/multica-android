import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import type { Agent } from "@multica/core/types";
import { api } from "@/data/api";
import { agentListOptions } from "@/data/queries/agents";
import { buildActivityMap, type AgentActivity } from "@/lib/agent-activity";
import { aggregateCatalogState, resolveCatalogState } from "@/lib/catalog-state";

// Workspace-scoped 30-day daily activity buckets — one fetch backs every
// agent's Last-30-days panel + sparkline. Mirrors web
// `agentActivity30dOptions` (packages/core/agents/queries.ts); the realtime
// layer refreshes it on task lifecycle events via the `["agent-activity",
// wsId]` prefix (data/realtime/use-presence-realtime.ts).
export const agentActivityKeys = {
  last30d: (wsId: string | null) => ["agent-activity", wsId, "30d"] as const,
  all: (wsId: string | null) => ["agent-activity", wsId] as const,
};

export const agentActivity30dOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: agentActivityKeys.last30d(wsId),
    queryFn: ({ signal }) => api.getWorkspaceAgentActivity30d({ signal }),
    staleTime: 60 * 1000,
    enabled: !!wsId,
  });

/**
 * Per-agent 30-day activity map, keyed by agent id. Mirrors web
 * `useWorkspaceActivityMap` (packages/core/agents/use-agent-activity.ts).
 * `agents` may be passed explicitly (e.g. the caller already holds the agent
 * list) to avoid a second agents fetch; otherwise it falls back to the
 * workspace agent-list query like web does.
 *
 * `state` is the aggregate load state of the two reads behind the map. A
 * caller that renders "this agent ran nothing in 30 days" out of an empty map
 * must gate on it: an empty map is produced both by a workspace with no
 * activity AND by a bucket read that never landed (MYS-1924, gap 3d).
 */
export function useAgentActivityMap(
  wsId: string | null,
  agents?: readonly Agent[] | null,
) {
  const bucketsQuery = useQuery(agentActivity30dOptions(wsId));
  const agentsQuery = useQuery({
    ...agentListOptions(wsId),
    enabled: !!wsId && !agents,
  });

  const byAgent = useMemo(() => {
    const list = agents ?? agentsQuery.data;
    if (!list || !bucketsQuery.data) return new Map<string, AgentActivity>();
    return buildActivityMap(list, bucketsQuery.data, Date.now());
  }, [agents, agentsQuery.data, bucketsQuery.data]);

  // When the caller supplies `agents`, the agent read is disabled here and its
  // `isPending` stays true forever — including it blindly would pin the whole
  // panel to "loading". Only the reads this hook actually issued count.
  const state = aggregateCatalogState([
    resolveCatalogState({
      items: bucketsQuery.data,
      isPending: bucketsQuery.isPending,
      isError: bucketsQuery.isError,
    }),
    agents
      ? "ready"
      : resolveCatalogState({
          items: agentsQuery.data,
          isPending: agentsQuery.isPending,
          isError: agentsQuery.isError,
        }),
  ]);

  return { byAgent, state, retry: bucketsQuery.refetch };
}