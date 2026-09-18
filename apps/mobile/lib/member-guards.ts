/**
 * Member management permission guards, extracted from the member detail
 * screen into a pure function so the self-protection / owner-protection
 * rules are unit-testable (the workspace has no second real member to
 * exercise them on-device).
 *
 * Mirrors web members-tab (packages/views/settings/components/
 * members-tab.tsx:100-103,152-155): a manager (owner/admin) can edit the
 * role of / remove a member they aren't; a target owner additionally
 * requires the actor to be an owner themselves, and the workspace's last
 * owner cannot be demoted at all.
 *
 * The server remains the authoritative gate — these guards only decide
 * whether the UI *shows* the actions, and mirror its two owner rules
 * (server/internal/handler/workspace.go:660-680).
 */
import type { MemberRole } from "@multica/core/types";

/** Shared coarse "manager" check — owner or admin. Both member management
 *  and workspace-level management (settings rename / leave / delete gating)
 *  use the same tier: web's canManageWorkspace
 *  (packages/views/settings/components/workspace-tab.tsx:146) is exactly
 *  `owner || admin`. Kept in member-guards because that's where the tier
 *  was first encoded; workspace-guards reuses it. */
export function canManageRole(
  role: MemberRole | null | undefined,
): boolean {
  return role === "owner" || role === "admin";
}

/** Roles a role-change sheet may offer, in display order (web iterates its
 *  roleConfig, members-tab.tsx:129-131). The owner entry is hidden rather
 *  than disabled when the actor isn't an owner: the server rejects that
 *  write outright (`requester.Role != "owner"` → 403), so offering it would
 *  only produce a failed mutation. */
export function roleChangeOptions({
  canManageOwners,
}: {
  canManageOwners: boolean;
}): MemberRole[] {
  return canManageOwners ? ["owner", "admin", "member"] : ["admin", "member"];
}

export interface MemberManageGuardsInput {
  /** Role of the current user's own membership row (null before the member
   *  list resolves or if their own membership isn't visible). */
  currentRole: MemberRole | null | undefined;
  /** Current user's User UUID. */
  currentUserId: string | null | undefined;
  /** The target member row (null while loading / not found). */
  target: { user_id: string | null; role: MemberRole } | null;
  /** Owners in the workspace. Defaults to 2 (i.e. "not the last owner") when
   *  unknown, matching the web guard's `members.filter(...)` count; callers
   *  that have the list always pass it. */
  ownerCount?: number;
}

export interface MemberManageGuards {
  canEditRole: boolean;
  canRemove: boolean;
  /** Actor may act on an owner target at all (web `canManageOwners`). */
  canManageOwners: boolean;
  /** Target is the workspace's only remaining owner — the demote option is
   *  disabled with an explanatory hint, mirroring web's
   *  `wouldDemoteLastOwner` (members-tab.tsx:133-141). */
  wouldDemoteLastOwner: boolean;
}

export function memberManageGuards({
  currentRole,
  currentUserId,
  target,
  ownerCount = 2,
}: MemberManageGuardsInput): MemberManageGuards {
  const canManage = canManageRole(currentRole);
  const isSelf =
    target != null &&
    currentUserId != null &&
    target.user_id === currentUserId;
  const canManageOwners = currentRole === "owner";
  const targetIsOwner = target?.role === "owner";
  // No target (still loading / not found) and self are untouchable: you
  // can't manage yourself. An owner target needs an owner actor.
  const manageable =
    target != null && canManage && !isSelf && (!targetIsOwner || canManageOwners);
  const canEditRole = manageable;
  const canRemove = manageable;
  const wouldDemoteLastOwner =
    targetIsOwner && ownerCount <= 1 && canEditRole;
  return { canEditRole, canRemove, canManageOwners, wouldDemoteLastOwner };
}
