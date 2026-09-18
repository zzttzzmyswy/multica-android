/**
 * Squad-join context for the manual agent-create form (iteration 121,
 * MYS-1032). Mirrors web use-create-agent-submit.ts: when the create page is
 * opened with a squad context, a successful create is followed by
 * POST /api/squads/:id/members {member_type:"agent", member_id}. The join is
 * best-effort — a failure must not fail the create itself (the agent exists;
 * the user is told and can add it manually from the squad page).
 */
export interface SquadJoinPayload {
  member_type: "agent";
  member_id: string;
}

export interface SquadJoinOutcome {
  squadId: string;
  payload: SquadJoinPayload | null;
  agentNameForError: string;
  /** Always false: the join is best-effort, a failure must never fail the
   *  create (web use-create-agent-submit.ts wraps it in its own try/catch).
   *  Carried on the outcome so the caller's catch-block contract is explicit
   *  and testable instead of a silent convention. */
  joinFatal: false;
}

export function agentSquadJoin(
  squadId: string | null | undefined,
  agentId: string,
  agentName: string,
): SquadJoinOutcome {
  const payload =
    squadId && agentId ? { member_type: "agent" as const, member_id: agentId } : null;
  return {
    squadId: squadId ?? "",
    payload,
    agentNameForError: agentName,
    joinFatal: false,
  };
}
