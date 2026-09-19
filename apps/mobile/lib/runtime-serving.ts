/**
 * Headless derivation for the runtime-detail "Serving" card — the agents bound
 * to one runtime, joined with their presence. Kept free of RN / Query imports
 * so the vitest lane (Node-only, no renderer) exercises the decisions the card
 * makes; the screen composes the result with the workspace presence map.
 *
 * Web counterpart: `packages/views/runtimes/components/runtime-detail.tsx`
 * (`servingAgents` filter + `ServingAgentsCard`). The two MUST agree on which
 * agents count as serving — archived agents keep their `runtime_id` but are
 * retired, so listing them would advertise capacity that cannot take work.
 */
import type {
  AgentAvailability,
  AgentPresenceDetail,
  Workload,
} from "@multica/core/agents";
import type { Agent } from "@multica/core/types";

export interface ServingAgentRow {
  id: string;
  name: string;
  availability: AgentAvailability;
  workload: Workload;
  runningCount: number;
  queuedCount: number;
  /**
   * Web renders the workload chip only when the agent is not idle: "Idle" next
   * to an availability dot says nothing the dot didn't already, and the chip's
   * whole point is to flag work in flight (or stuck in the queue).
   */
  showWorkload: boolean;
}

/**
 * Presence for an agent missing from the map. Same shape web falls back to
 * (`availabilityConfig.offline` + no workload chip) — a bound agent whose
 * presence hasn't resolved yet is offline, not "unknown".
 */
const ABSENT_PRESENCE: Pick<
  AgentPresenceDetail,
  "availability" | "workload" | "runningCount" | "queuedCount"
> = {
  availability: "offline",
  workload: "idle",
  runningCount: 0,
  queuedCount: 0,
};

/**
 * Agents serving `runtimeId`, in the server's list order (web does not sort
 * either — a stable order across refetches matters more than an alphabetical
 * one, and the list is short enough that scanning beats searching).
 */
export function buildServingAgents(
  agents: readonly Agent[],
  runtimeId: string | null | undefined,
  presenceByAgent: ReadonlyMap<string, AgentPresenceDetail>,
): ServingAgentRow[] {
  if (!runtimeId) return [];

  const rows: ServingAgentRow[] = [];
  for (const agent of agents) {
    if (agent.runtime_id !== runtimeId || agent.archived_at) continue;
    const presence = presenceByAgent.get(agent.id) ?? ABSENT_PRESENCE;
    rows.push({
      id: agent.id,
      name: agent.name,
      availability: presence.availability,
      workload: presence.workload,
      runningCount: presence.runningCount,
      queuedCount: presence.queuedCount,
      showWorkload: presence.workload !== "idle",
    });
  }
  return rows;
}
