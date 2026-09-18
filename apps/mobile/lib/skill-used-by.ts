/**
 * Skill-detail "Used by" helpers — web parity for the agent bindings
 * surface of a skill (packages/views/skills/components/skill-detail-page.tsx
 * `selectSkillAssignments` + skill-list-actions.tsx `partitionAgents`).
 *
 * Both are pure functions over the workspace agent list (which already
 * carries each agent's bound `skills`), so the detail screen can derive
 * everything from the shared agent list cache without extra round-trips.
 */
import type { Agent } from "@multica/core/types";

/**
 * Active (non-archived) agents that have `skillId` bound, in list order.
 * Same semantics as web `selectSkillAssignments(...).get(skillId)` for a
 * single skill — skips archived agents and empty bindings.
 */
export function agentsForSkill(agents: Agent[], skillId: string): Agent[] {
  return agents.filter(
    (a) => !a.archived_at && (a.skills ?? []).some((s) => s.id === skillId),
  );
}

/**
 * Split active agents into "mine" (owner matches the current user) and
 * "others" (unowned + other-owned, visible to admins only). Mirrors web
 * `partitionAgents` — members see their own agents; workspace owners/admins
 * see all, so the add sheet never offers a target the API would reject.
 */
export function partitionAgentsForSkill(
  agents: Agent[],
  currentUserId: string | null,
  isAdmin: boolean,
): { mine: Agent[]; others: Agent[] } {
  const active = agents.filter((a) => !a.archived_at);
  const mine = active.filter(
    (a) => a.owner_id !== null && a.owner_id === currentUserId,
  );
  const others = isAdmin
    ? active.filter(
        (a) => a.owner_id === null || a.owner_id !== currentUserId,
      )
    : [];
  return { mine, others };
}
