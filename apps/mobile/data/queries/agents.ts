import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const agentKeys = {
  list: (wsId: string | null) => ["agents", wsId] as const,
  // Archived-included variant. Agents stay reachable after archive so the
  // detail screen can keep showing the archived banner + restore (web parity:
  // a retired agent is still viewable, just dimmed).
  listAll: (wsId: string | null) => ["agents", wsId, "all"] as const,
  env: (agentId: string) => ["agent-env", agentId] as const,
};

export const agentListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: agentKeys.list(wsId),
    queryFn: ({ signal }) => api.listAgents({ signal }),
    enabled: !!wsId,
  });

// Agent list INCLUDING archived, for the agents screen + agent detail/edit/env
// routes. Archives never enter the picker / chat / mention paths, which keep
// `agentListOptions` above.
export const agentListAllOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: agentKeys.listAll(wsId),
    queryFn: ({ signal }) =>
      api.listAgents({ signal, includeArchived: true }),
    enabled: !!wsId,
  });

// Agent custom_env for the env screen. Deliberately NOT wired to auto-fetch
// on mount: every GET /api/agents/:id/env call writes an `agent_env_revealed`
// audit row server-side, so the reveal must be intentional (web env-tab keeps
// the same gate — values never load until the user clicks "Reveal & edit").
// The env screen spreads these options with `enabled` flipped only after the
// user reveals.
export const agentEnvOptions = (agentId: string) =>
  queryOptions({
    queryKey: agentKeys.env(agentId),
    queryFn: () => api.getAgentEnv(agentId),
    enabled: false,
  });