import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

// Per-agent full task history — the web "Recent work" list source. Keyed
// under the `["agent-tasks", wsId]` prefix so the realtime layer's
// task-lifecycle invalidation (data/realtime/use-presence-realtime.ts)
// refreshes every agent's list in one go.
export const agentTaskKeys = {
  list: (wsId: string | null) => ["agent-tasks", wsId] as const,
  detail: (wsId: string | null, agentId: string) =>
    ["agent-tasks", wsId, agentId] as const,
};

export const agentTasksOptions = (wsId: string | null, agentId: string) =>
  queryOptions({
    queryKey: agentTaskKeys.detail(wsId, agentId),
    queryFn: ({ signal }) => api.listAgentTasks(agentId, { signal }),
    staleTime: 30 * 1000,
    enabled: !!wsId,
  });