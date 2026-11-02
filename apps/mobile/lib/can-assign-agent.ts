/**
 * Mobile-owned mirror of
 * `packages/core/permissions/rules.ts:canAssignAgentToIssue` — the rule web's
 * assignee picker, chat picker, mention bar and agent page all funnel through.
 *
 * We mirror (not import) per the apps/mobile/CLAUDE.md sharing rule: only
 * `import type` from @multica/core; logic is duplicated to keep mobile
 * independent. Any rule change must be applied here too.
 *
 * Judged on `permission_mode` + `invocation_targets`, NEVER on `visibility`
 * (MUL-3963). `visibility` is a DERIVED two-state projection the backend
 * recomputes on every response (`server/internal/handler/agent_permission.go:
 * deriveLegacyVisibility`): a `public_to` agent whose only grant is a single
 * named member projects to `visibility: "private"`. Reading it therefore
 * answers a different question than the server enforces — which is exactly
 * what this file did before MYS-2550, and it was wrong in both directions
 * (an admin passed on someone else's private agent the server 403s; a granted
 * member was refused an agent they may invoke).
 *
 * The rule, from `server/internal/handler/agent_access.go:canInvokeAgent`:
 *   - the owner                      → always
 *   - `private` (or unknown)         → nobody else. NO ADMIN BYPASS.
 *   - `public_to` + workspace target → any member of this workspace
 *   - `public_to` + member target    → only that user
 *   - `team` target                  → reserved and INERT in v1; never grants
 *   - no targets at all              → nobody but the owner
 *
 * `team` and unknown target types fail closed deliberately: the server's
 * allow-list only walks the two types it knows, so treating an unrecognised
 * one as a grant would offer a call it refuses. An unknown `permission_mode`
 * is likewise the deny side, not the workspace side.
 *
 * Used by the chat agent picker to filter "agents I can talk to", by the issue
 * assignee picker to grey out rows the server would reject, by the agent
 * page's primary actions, and by NoAgentBanner to detect the all-zero state.
 */
import type {
  Agent,
  AgentInvocationTarget,
  AgentPermissionMode,
} from "@multica/core/types";

type MemberRoleLike = "owner" | "admin" | "member" | null | undefined;

/** The two fields the rule actually reads — not the whole `Agent`, so a
 *  caller holding a partial row (a list projection, a cached task's agent)
 *  can still ask the question. */
export type AssignableAgent = Pick<
  Agent,
  "owner_id" | "permission_mode" | "invocation_targets"
>;

/** Narrow an arbitrary role string to the three roles that mean "this caller
 *  is a member of the workspace". Anything else — `null` while membership
 *  loads, an empty string from an older backend — is modelled as non-member,
 *  which is what the server's workspace-target branch sees too. */
function membershipRole(memberRole: MemberRoleLike): MemberRoleLike {
  return memberRole === "owner" || memberRole === "admin" || memberRole === "member"
    ? memberRole
    : null;
}

export function canAssignAgent(
  agent: AssignableAgent,
  userId: string | undefined | null,
  memberRole: MemberRoleLike,
): boolean {
  if (!userId) return false;

  // The owner may always invoke their own agent, whatever the mode and
  // whatever their role — the server checks this before anything else.
  if (agent.owner_id != null && agent.owner_id === userId) return true;

  const mode: AgentPermissionMode | string = agent.permission_mode;
  if (mode !== "public_to") {
    // `private`, plus any mode this build does not know: deny by default, and
    // specifically WITHOUT the admin bypass the legacy visibility model had.
    return false;
  }

  const targets: readonly AgentInvocationTarget[] = agent.invocation_targets ?? [];
  const role = membershipRole(memberRole);

  // A workspace grant opens invocation to every member of this workspace.
  if (targets.some((t) => t.target_type === "workspace")) {
    return role !== null;
  }

  // A member grant opens invocation to exactly the targeted user. Team
  // targets are reserved and inert, so they reach neither branch.
  return targets.some(
    (t) => t.target_type === "member" && t.target_id === userId,
  );
}
