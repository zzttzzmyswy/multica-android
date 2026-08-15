/**
 * Member management permission guards, extracted from the member detail
 * screen into a pure function so the self-protection / owner-protection
 * rules are unit-testable (the workspace has no second real member to
 * exercise them on-device).
 *
 * Mirrors web members-tab (packages/views/settings/components/
 * members-tab.tsx:100-103): a manager (owner/admin) can edit the role of /
 * remove a member they aren't, and only a target that isn't an owner.
 * Mobile deliberately drops the owner role from the change sheet (owner
 * promotion/demotion stays a web action per MYS-303 scope), so a target
 * owner is never editable/removable here.
 *
 * The server remains the authoritative gate — these guards only decide
 * whether the UI *shows* the actions.
 */
import type { MemberRole } from "@multica/core/types";

export interface MemberManageGuardsInput {
  /** Role of the current user's own membership row (null before the member
   *  list resolves or if their own membership isn't visible). */
  currentRole: MemberRole | null | undefined;
  /** Current user's User UUID. */
  currentUserId: string | null | undefined;
  /** The target member row (null while loading / not found). */
  target: { user_id: string | null; role: MemberRole } | null;
}

export interface MemberManageGuards {
  canEditRole: boolean;
  canRemove: boolean;
}

export function memberManageGuards({
  currentRole,
  currentUserId,
  target,
}: MemberManageGuardsInput): MemberManageGuards {
  const canManage = currentRole === "owner" || currentRole === "admin";
  const isSelf =
    target != null &&
    currentUserId != null &&
    target.user_id === currentUserId;
  const targetIsOwner = target?.role === "owner";
  // No target (still loading / not found), self, and owner targets are all
  // untouchable: you can't manage yourself, and a target owner is never
  // editable/removable on mobile.
  const canEditRole =
    target != null && canManage && !isSelf && !targetIsOwner;
  const canRemove =
    target != null && canManage && !isSelf && !targetIsOwner;
  return { canEditRole, canRemove };
}