import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const agentKeys = {
  list: (wsId: string | null) => ["agents", wsId] as const,
  // Archived-included variant. Agents stay reachable after archive so the
  // detail screen can keep showing the archived banner + restore (web parity:
  // a retired agent is still viewable, just dimmed).
  listAll: (wsId: string | null) => ["agents", wsId, "all"] as const,
  env: (agentId: string) => ["agent-env", agentId] as const,
  // The "can I see this one at all?" probe (MYS-2161). Its own key, not a
  // single-agent cache entry: a successful probe is deliberately unused (the
  // screen already knows the agent is absent from the list it resolved against),
  // and caching a whole Agent under an id-keyed entry nothing reads would be a
  // second, quietly-diverging copy of the same row.
  accessProbe: (wsId: string | null, agentId: string | null | undefined) =>
    ["agent-access-probe", wsId, agentId] as const,
  // Workspace-wide 30-day run counts (the agents list's RUNS sort). Mirrors
  // core's `agentRunCountsKeys.last30d` so the same WS invalidation surface
  // can reach both clients.
  runCounts30d: (wsId: string | null) =>
    ["agent-run-counts", wsId, "30d"] as const,
  // AI-builder creation conversations (web Creation Studio). Keyed on the
  // workspace; rows are the unfinished sessions the studio re-lists.
  builderSessions: (wsId: string | null) => ["agent-builder-sessions", wsId] as const,
};

export const agentListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: agentKeys.list(wsId),
    queryFn: ({ signal }) => api.listAgents({ signal }),
    enabled: !!wsId,
  });

// Agent list INCLUDING archived, for the agents screen + agent detail/edit/env
// routes, and for resolving the identity of an agent that history still
// references (chat session rows, the chat screen's session agent, the shared
// actor lookup). Archives never enter the *picker* paths, which keep
// `agentListOptions` above — a retired agent must not be selectable, but it
// must still render as itself wherever it already appears.
export const agentListAllOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: agentKeys.listAll(wsId),
    queryFn: ({ signal }) =>
      api.listAgents({ signal, includeArchived: true }),
    enabled: !!wsId,
  });

// Workspace-wide 30-day run count per agent, feeding the agents list's RUNS
// sort (web `agentRunCounts30dOptions`, core/agents/queries.ts:110-118).
// `sortable` keeps the fetch off the list until the user actually orders by
// RUNS — the metric has no other consumer on the phone, and an unconditional
// request per agents-page visit would be pure cost.
export const agentRunCounts30dOptions = (
  wsId: string | null,
  sortable = false,
) =>
  queryOptions({
    queryKey: agentKeys.runCounts30d(wsId),
    queryFn: ({ signal }) => api.getWorkspaceAgentRunCounts({ signal }),
    staleTime: 60 * 1000,
    enabled: !!wsId && sortable,
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

/**
 * The private-agent access probe (MYS-2161) — `GET /api/agents/{id}`, fired
 * ONLY when the workspace agent list has settled without this id in it.
 *
 * Why the screen needs it: the list is filtered server-side by
 * `memberAllowedToViewAgent`, so a private agent the caller may not see is
 * absent from it — the same shape as one that was deleted. The detail endpoint
 * is the only surface that distinguishes them (403 vs 404; see
 * `ApiClient.getAgent` and handler/agent.go:964-968, whose comment names this
 * exact probe as the front-end contract).
 *
 * The gate is passed in rather than derived here, because only the caller knows
 * whether the list it resolved against has settled and whether it found the
 * row. `enabled: false` on the common path is the point: an agent reached from
 * the list is already resolved, and this must cost nothing there. Falsifying
 * the gate turns the suite red — see `scripts/falsify-iter243-agent-403.py`.
 *
 * `retry: false` matches web (`agent-detail-page.tsx:99`): the answer is a
 * permission verdict, not a flaky read, so a retry pass would only delay the
 * face the user is owed. `staleTime: 0` keeps a verdict from being reused
 * across a visibility change (an admin granting access mid-session).
 */
export const agentAccessProbeOptions = (
  wsId: string | null,
  agentId: string | null | undefined,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: agentKeys.accessProbe(wsId, agentId),
    queryFn: ({ signal }) => api.getAgent(agentId as string, { signal }),
    enabled: enabled && !!agentId,
    retry: false,
    staleTime: 0,
  });

// Unfinished AI-builder creation conversations. Mirrors web's
// `agentBuilderSessionListOptions` (packages/core/agents/queries.ts). The
// list is invalidated by every session lifecycle event (start / first turn /
// discard / archive) so the drafts banner on the AI setup screen stays fresh.
export const agentBuilderSessionListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: agentKeys.builderSessions(wsId),
    queryFn: () => api.listAgentBuilderSessions(),
    enabled: !!wsId,
  });