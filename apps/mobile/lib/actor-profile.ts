/**
 * Pure derivation for the actor profile cards (iteration 179, G14).
 *
 * Web parity targets, read first-hand:
 *   - member card `packages/views/members/member-profile-card.tsx:78-92`
 *     (owned-agents filter + sort) and `:137-170` (top-2 + overflow).
 *   - agent card `packages/views/agents/components/agent-profile-card.tsx:60-72`
 *     (owner lookup) and `:110-112` (availability row suppressed when archived).
 *   - squad card `packages/views/squads/components/squad-profile-card.tsx:130-190`
 *     (top-3 + `member_count`-based overflow + leader chip + name fallback).
 *
 * The unresolved-member fallback is `member_id.slice(0, 8)` on web — NOT
 * "Unknown". A row must still identify *which* member is missing, and the two
 * clients have to agree on what it reads.
 */
import type {
  Agent,
  AgentRunCount,
  MemberWithUser,
  Squad,
  SquadMemberPreview,
} from "@multica/core/types";

/** How many owned agents the member card lists before collapsing to a count. */
export const MEMBER_CARD_AGENT_LIMIT = 2;
/** How many squad members the squad card lists before collapsing to a count. */
export const SQUAD_CARD_MEMBER_LIMIT = 3;

/**
 * Live agents owned by `userId`, most-run first. Ties break on name ascending
 * so the card's order is stable across refetches; an agent with no row in the
 * 30-day counts ranks as zero rather than dropping out (web reads
 * `runCountById.get(id) ?? 0` the same way).
 */
export function ownedAgentsOf(
  agents: readonly Agent[],
  userId: string,
  runCounts: readonly AgentRunCount[],
): Agent[] {
  const runCountById = new Map(runCounts.map((r) => [r.agent_id, r.run_count]));
  return agents
    .filter((a) => a.owner_id === userId && !a.archived_at)
    .sort((a, b) => {
      const ra = runCountById.get(a.id) ?? 0;
      const rb = runCountById.get(b.id) ?? 0;
      if (ra !== rb) return rb - ra;
      return a.name.localeCompare(b.name);
    });
}

/** Split a list into the leading slice plus the count left over. */
export function visibleWithOverflow<T>(
  items: readonly T[],
  limit: number,
): { visible: T[]; overflow: number } {
  const visible = items.slice(0, limit);
  return { visible, overflow: items.length - visible.length };
}

export interface SquadMemberRow {
  /** Stable list key — a member and an agent may share an id. */
  key: string;
  memberType: SquadMemberPreview["member_type"];
  memberId: string;
  /** Resolved name, or the id's first 8 chars when the actor is unknown. */
  name: string;
  /** Only an *agent* equal to `squad.leader_id` carries the leader chip. */
  isLeader: boolean;
  /** Workspace role, for member rows only (web `:180-184`). */
  role: string | null;
  /**
   * Id to push for the row's detail route: the agent id for an agent, the
   * workspace-membership id for a member (mobile's member detail is keyed on
   * the membership, not the user — `more/members.tsx:227`), null when the
   * actor could not be resolved and the row has nowhere to go.
   */
  detailId: string | null;
}

/**
 * Squad card member section. `member_count` is authoritative for the overflow
 * number (the preview is a truncated sample), but the visible slice comes from
 * the preview — so a server that omits the preview still reports the right
 * "and N more" instead of silently reading zero.
 */
export function squadMemberRows(
  squad: Squad,
  agents: readonly Agent[],
  members: readonly MemberWithUser[],
): { visible: SquadMemberRow[]; overflow: number } {
  const preview = squad.member_preview ?? [];
  const memberCount = squad.member_count ?? preview.length;
  const { visible, overflow } = visibleWithOverflow(
    preview,
    SQUAD_CARD_MEMBER_LIMIT,
  );

  return {
    visible: visible.map((m) => {
      const isAgent = m.member_type === "agent";
      const resolved = isAgent
        ? agents.find((a) => a.id === m.member_id)
        : members.find((u) => u.user_id === m.member_id);
      return {
        key: `${m.member_type}-${m.member_id}`,
        memberType: m.member_type,
        memberId: m.member_id,
        name: resolved?.name ?? m.member_id.slice(0, 8),
        isLeader: isAgent && m.member_id === squad.leader_id,
        role: isAgent ? null : (resolved as MemberWithUser | undefined)?.role ?? null,
        detailId: resolved ? (isAgent ? m.member_id : resolved.id) : null,
      };
    }),
    overflow: Math.max(0, memberCount - visible.length),
  };
}

/**
 * Plural key for a `{{count}}` string. The mobile locale bundle stores both
 * forms as flat `_one` / `_other` keys (`comment.trigger_will_start_count_one`
 * et al.) because `translate()` does no plural resolution of its own — the
 * caller picks the form. Keeping the pick here means the two cards can't drift
 * on where the boundary sits.
 */
export function countLabelKey(base: string, count: number): string {
  return count === 1 ? `${base}_one` : `${base}_other`;
}
