import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const agentKeys = {
  list: (wsId: string | null) => ["agents", wsId] as const,
};

export const agentListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: agentKeys.list(wsId),
    queryFn: ({ signal }) => api.listAgents({ signal }),
    enabled: !!wsId,
  });