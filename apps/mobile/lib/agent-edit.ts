/**
 * Pure helpers for the agent EDIT form (more/agents/[id]/edit). Create-side
 * counterparts live in lib/agent-create.ts; this module only carries what an
 * edit run needs that create doesn't share.
 *
 * The one real divergence is the runtime gate: create requires the runtime to
 * be online AND usable (a brand-new agent needs somewhere to run), while edit
 * keeps the agent's existing binding — which may legitimately be offline. So
 * `agentEditGate` only demands that a runtime is selected, never that it's
 * currently usable.
 */
import {
  isDraftDescriptionWithinLimit,
  type AgentDraft,
} from "@multica/core/agents";

export interface AgentEditGate {
  nameMissing: boolean;
  runtimeMissing: boolean;
  accessInvalid: boolean;
  descriptionOverLimit: boolean;
}

/** Every non-name precondition the save button depends on. Mirror of
 *  `agentCreateGate`, with the runtime bound-check relaxed (see header). */
export function agentEditGate(draft: AgentDraft): AgentEditGate {
  return {
    nameMissing: draft.name.trim().length === 0,
    runtimeMissing: !draft.runtimeId.trim(),
    accessInvalid:
      draft.permissionScope === "members" &&
      draft.memberIds.size === 0 &&
      draft.teamIds.size === 0,
    descriptionOverLimit: !isDraftDescriptionWithinLimit(draft.description),
  };
}