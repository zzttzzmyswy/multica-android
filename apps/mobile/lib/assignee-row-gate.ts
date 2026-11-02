/**
 * Whether an assignee-picker row can be picked, and — when it cannot — why.
 *
 * Pure, so the decision is testable in the Node lane: the row UI lives in
 * `components/issue/pickers/assignee-picker-body.tsx`, which mobile's vitest
 * config cannot render.
 *
 * Mirrors web's row gating in
 * `packages/views/issues/components/pickers/assignee-picker.tsx`:
 *
 *   - **agent** rows: `canAssignAgentToIssue(...).allowed && isAgentRuntimeBound`.
 *     Two independent gates, and web's tooltip reports the PERMISSION one first
 *     when both fail, so permission takes precedence here too.
 *   - **squad** rows: runtime only — the leader must have a bound runtime
 *     (`runnableAgentIds.has(s.leader_id)`). Web does NOT additionally check the
 *     leader's invocation permission on this row, so neither does this helper;
 *     adding that check would refuse rows web offers, which is drift in the
 *     other direction. (The server does reject a private leader on assignment —
 *     that is web's existing behaviour, not a mobile regression.)
 *   - **member** / **unassigned** rows: never blocked. Assigning to a person
 *     has no invoke gate.
 *
 * Before MYS-2550 the mobile picker consulted ONLY the runtime gate: a row for
 * an agent the caller may not invoke looked exactly like a pickable one, and
 * the refusal only arrived after the write — as a server 403 with no
 * explanation. That is a permissions divergence, not a cosmetic one: web greys
 * the row and says why.
 */
import type { MemberRole } from "@multica/core/types";
import { canAssignAgent, type AssignableAgent } from "./can-assign-agent";

/** Why a row cannot be picked. Each maps to its own sentence in the row. */
export type AssigneeRowBlockReason =
  /** The agent (or the squad's leader) has no bound runtime, so a run would fail. */
  | "runtime"
  /** The caller may not invoke this agent (`permission_mode` + grants). */
  | "permission";

export interface AssigneeRowGateInput {
  kind: "unassigned" | "member" | "agent" | "squad";
  /** The agent, for `kind === "agent"`. */
  agent?: AssignableAgent;
  /** Whether this row has a bound runtime: the agent itself for `kind ===
   *  "agent"`, its LEADER for `kind === "squad"`. Omit for member/unassigned. */
  runtimeBound?: boolean;
  /** The signed-in user. Required for the permission gate; a null/undefined id
   *  (auth still resolving) blocks every agent row, the same way the server
   *  denies an unattributed caller. */
  userId: string | null | undefined;
  /** The caller's role in this workspace; `null` is "not a member / not yet
   *  resolved", which the permission rule treats as no workspace access. */
  role: MemberRole | null;
}

/**
 * The first reason this row is blocked, or `null` when it can be picked.
 * Permission outranks runtime, matching web's tooltip precedence: binding a
 * runtime would not make a forbidden agent assignable, so naming runtime there
 * would send the reader down a path that cannot succeed.
 */
export function assigneeRowBlock(
  input: AssigneeRowGateInput,
): AssigneeRowBlockReason | null {
  switch (input.kind) {
    case "unassigned":
    case "member":
      return null;
    case "agent":
      if (input.agent && !canAssignAgent(input.agent, input.userId, input.role)) {
        return "permission";
      }
      return input.runtimeBound === false ? "runtime" : null;
    case "squad":
      return input.runtimeBound === false ? "runtime" : null;
  }
}
