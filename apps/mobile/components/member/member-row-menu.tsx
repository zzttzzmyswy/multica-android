/**
 * Members-LIST row actions — the "⋯" each manageable row gained in iteration
 * 231 (MYS-2102), mirroring web's `MemberRow` menu
 * (`packages/views/settings/components/members-tab.tsx:100-171`).
 *
 * Before this round the row's only exit was `router.push` to the member detail
 * page, so changing a role or removing a member meant opening the member first.
 * Both writes already lived on the detail page — what was missing was this
 * entry point.
 *
 * Which items appear is decided by the tested pure helper `memberRowActions`
 * (`lib/member-row-actions.ts`), which in turn delegates the permission rules to
 * `lib/member-guards.ts` so the list and the detail page cannot disagree about
 * "you cannot demote the last owner". This component renders the sheet and
 * routes the choice; the writes belong to the LIST screen.
 *
 * Two web shapes are mirrored on purpose:
 *   - **The role submenu lists only roles the actor may actually grant.** Web
 *     drops the owner entry for a non-owner actor (`:131`) — the server rejects
 *     that write with 403 — and the sheet therefore offers two or three roles,
 *     not a fixed three.
 *   - **The demote entry on the last owner is present but inert-with-a-hint.**
 *     Web renders it `disabled` with `cannot_demote_last_owner` swapped in for
 *     the description (`:133-141`). A native action sheet has no per-option
 *     disabled state, so an inert tap shows the same hint as an alert — the
 *     same interception the detail page already uses, and the server would
 *     reject the write regardless.
 *
 * Differences from web that come from the platform, not a change of intent:
 *   - Web's members kebab holds the role submenu and remove only, so there is
 *     no "Open in new tab" entry to omit here.
 *   - The sheet is `ActionSheet.showActionSheetWithOptions` (this app's native
 *     menu pattern) rather than a rendered dropdown.
 */
import { useCallback } from "react";
import { Alert } from "react-native";
import type { MemberRole, MemberWithUser } from "@multica/core/types";
import { IconButton } from "@/components/ui/icon-button";
import { ActionSheet } from "@/lib/action-sheet";
import {
  memberRowActions,
  type MemberRowAction,
} from "@/lib/member-row-actions";
import { useTranslation } from "@/lib/i18n/react";

const LABEL_KEY: Record<MemberRowAction, string> = {
  // Web's `members.change_role` / `members.remove_action`. Both already exist on
  // the detail page's own manage section, so the same verb reads the same way
  // wherever it is reached from.
  "change-role": "members.detail.changeRole",
  remove: "members.detail.removeAction",
};

export function MemberRowMenu({
  member,
  currentRole,
  currentUserId,
  ownerCount,
  onRoleChange,
  onRemove,
}: {
  member: MemberWithUser;
  /** Role of the current user's own workspace membership row. */
  currentRole: MemberRole | null | undefined;
  /** Current user's User UUID. */
  currentUserId: string | null | undefined;
  /** Owners in the workspace — the last-owner demote guard reads this. */
  ownerCount: number;
  /** Apply a role change. Owned by the screen so the kebab and the detail page
   *  share one mutation and one failure copy. */
  onRoleChange: (row: MemberWithUser, role: MemberRole) => void;
  /** Open the remove confirm for this row. */
  onRemove: (row: MemberWithUser) => void;
}) {
  const { t } = useTranslation();
  const { actions, roleChoices } = memberRowActions(member, {
    currentRole,
    currentUserId,
    ownerCount,
  });

  /** Web's role submenu, flattened into a second sheet. */
  const openRoleSheet = useCallback(() => {
    // Every entry carries its description as the second line, exactly as web's
    // submenu does — the action sheet has no two-line option, so the hint is
    // appended to the label. A disabled entry shows the cannot-demote hint
    // instead of its own description, web's `:138-141` swap.
    const labels = roleChoices.map((choice) => {
      const name = t(`members.role.${choice.role}`);
      if (choice.disabled) {
        return `${name} — ${t("members.detail.cannotDemoteLastOwner")}`;
      }
      return choice.current ? `${name} ✓` : name;
    });
    ActionSheet.showActionSheetWithOptions(
      {
        title: t("members.detail.changeRole"),
        options: [...labels, t("common.cancel")],
        cancelButtonIndex: labels.length,
      },
      (index) => {
        const choice = roleChoices[index];
        if (!choice) return;
        // Already this role, or the entry web disables: a no-op. The detail
        // page intercepts the last-owner case with the same alert rather than
        // letting the server return 403.
        if (choice.current) return;
        if (choice.disabled) {
          Alert.alert(
            t("members.detail.changeRole"),
            t("members.detail.cannotDemoteLastOwner"),
          );
          return;
        }
        onRoleChange(member, choice.role);
      },
    );
  }, [roleChoices, member, t, onRoleChange]);

  const openMenu = useCallback(() => {
    if (actions.length === 0) return;
    const labels = actions.map((action) => t(LABEL_KEY[action]));
    const destructiveButtonIndex = actions.indexOf("remove");
    ActionSheet.showActionSheetWithOptions(
      {
        title: member.name,
        options: [...labels, t("common.cancel")],
        cancelButtonIndex: labels.length,
        ...(destructiveButtonIndex >= 0 ? { destructiveButtonIndex } : {}),
      },
      (index) => {
        const action = actions[index];
        if (!action) return;
        if (action === "change-role") openRoleSheet();
        else onRemove(member);
      },
    );
  }, [actions, member, t, openRoleSheet, onRemove]);

  // Web's `showMenu` — you cannot manage yourself, and a non-manager gets no
  // menu on anyone.
  if (actions.length === 0) return null;

  return (
    <IconButton
      name="ellipsis-horizontal"
      onPress={openMenu}
      accessibilityLabel={t("members.actions.open", { name: member.name })}
    />
  );
}
