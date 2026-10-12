/**
 * Which actions a members-LIST row offers — the pure half of the list-row kebab
 * added in iteration 231 (MYS-2102), mirroring web's `MemberRow` menu
 * (`packages/views/settings/components/members-tab.tsx:100-171`).
 *
 * Before this round the row's only exit was `router.push` to the member detail
 * page, so changing a role or removing a member meant opening the member first.
 * Both writes already existed on the detail page — what was missing was this
 * entry point.
 *
 * This module is DELIBERATELY THIN: the permission rules themselves are not
 * re-derived here. `lib/member-guards.ts` already encodes them (`canEditRole` /
 * `canRemove` / `canManageOwners` / `wouldDemoteLastOwner`) and the detail page
 * already consumes them; web has the same shape, where `MemberRow` recomputes
 * `canEditRole`/`canRemove` from props the parent passes to both the list and
 * its own row. Re-implementing the guards here is the fork this avoids — a
 * second copy of "you cannot demote the last owner" is how the two screens come
 * to disagree.
 *
 * What this module adds is the two things web's row menu does that
 * `memberManageGuards` does not model:
 *
 *   1. **`showMenu = canEditRole || canRemove`** (`:103`) decides the trigger's
 *      existence. In `member-guards` both flags come from the same `manageable`
 *      expression, so they always agree today — but web computes them as two
 *      separate gates, and a row with only one of them must still get a kebab
 *      holding that one item rather than an empty sheet.
 *   2. **The role submenu's option list is further filtered** (`:129-141`):
 *      `owner` is *dropped entirely* when the actor is not an owner, and
 *      non-owner entries are *disabled with a hint* on the last owner. The
 *      detail page already implements this on tap (`members/[id].tsx`); the
 *      list needs the same, and both must read `roleChangeOptions` +
 *      `wouldDemoteLastOwner` rather than re-deriving them.
 *
 * `open_in_new_tab` is not ported: a phone has no tabs and the row tap already
 * opens the member.
 */
import type { MemberRole, MemberWithUser } from "@multica/core/types";
import { memberManageGuards, roleChangeOptions } from "./member-guards";

export type MemberRowAction = "change-role" | "remove";

/** One entry of the role submenu — the role plus why it may be unchoosable. */
export interface MemberRoleChoice {
  role: MemberRole;
  /** Already the member's role: the row shows a tick and a tap is a no-op. */
  current: boolean;
  /** Web sets `disabled` and swaps the description for the hint (`:133-141`). */
  disabled: boolean;
};

/** The slice of a list row the decisions read. */
export type MemberRowActionInput = Pick<MemberWithUser, "id" | "user_id" | "role">;

export interface MemberRowActionInputs {
  /** Role of the current user's own membership row. */
  currentRole: MemberRole | null | undefined;
  /** Current user's User UUID. */
  currentUserId: string | null | undefined;
  /** Owners in the workspace — feeds the last-owner demotion guard. */
  ownerCount: number;
}

export interface MemberRowActions {
  /** The kebab's items, in menu order (web: role submenu, then remove). */
  actions: MemberRowAction[];
  /** Whether the trigger renders at all (web's `showMenu`). */
  showMenu: boolean;
  /** The role submenu's entries, owner-filtered and last-owner-disabled. */
  roleChoices: MemberRoleChoice[];
}

/**
 * Everything the members-list kebab needs for one row.
 *
 * The guards come from `memberManageGuards` unchanged; the two web rules above
 * are layered on top. `wouldDemoteLastOwner` is only meaningful when the actor
 * may edit the role at all (the guard itself already requires `canEditRole`),
 * so a non-manager gets no disabled entries — they get no menu.
 */
export function memberRowActions(
  row: MemberRowActionInput,
  inputs: MemberRowActionInputs,
): MemberRowActions {
  const { canEditRole, canRemove, canManageOwners, wouldDemoteLastOwner } =
    memberManageGuards({
      currentRole: inputs.currentRole,
      currentUserId: inputs.currentUserId,
      target: { user_id: row.user_id, role: row.role },
      ownerCount: inputs.ownerCount,
    });

  const actions: MemberRowAction[] = [];
  if (canEditRole) actions.push("change-role");
  if (canRemove) actions.push("remove");

  // Web iterates its `roleConfig` (owner/admin/member) and drops the owner
  // entry for a non-owner actor — the server rejects that write outright
  // (`requester.Role != "owner"` → 403), so listing it would only produce a
  // failed mutation. `roleChangeOptions` owns that cut.
  const roleChoices: MemberRoleChoice[] = canEditRole
    ? roleChangeOptions({ canManageOwners }).map((role) => ({
        role,
        current: role === row.role,
        // Web: `wouldDemoteLastOwner = isLastOwner && role !== "owner"`.
        disabled: wouldDemoteLastOwner && role !== "owner",
      }))
    : [];

  return { actions, showMenu: actions.length > 0, roleChoices };
}
