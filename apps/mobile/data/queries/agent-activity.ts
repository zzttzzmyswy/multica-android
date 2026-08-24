import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import type { Agent } from "@multica/core/types";
import { api } from "@/data/api";
import { agentListOptions } from "@/data/queries/agents";
import { buildActivityMap, type AgentActivity } from "@/lib/agent-activity";

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
 */
export function useAgentActivityMap(
  wsId: string | null,
  agents?: readonly Agent[] | null,
) {
  const { data: buckets } = useQuery(agentActivity30dOptions(wsId));
  const { data: fetchedAgents } = useQuery({
    ...agentListOptions(wsId),
    enabled: !!wsId && !agents,
  });

  const byAgent = useMemo(() => {
    const list = agents ?? fetchedAgents;
    if (!list || !buckets) return new Map<string, AgentActivity>();
    return buildActivityMap(list, buckets, Date.now());
  }, [agents, fetchedAgents, buckets]);

  return { byAgent };
}