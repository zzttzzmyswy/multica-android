/**
 * Properties-LIST row actions — the "⋯" each row gained in iteration 231
 * (MYS-2102), mirroring web's row menu
 * (`packages/views/settings/components/properties-tab.tsx:260-315`).
 *
 * Before this round the row's only exit was `router.push` to the edit form, so
 * archiving — or restoring — this deployment's `Severity` property meant opening
 * it first.
 *
 * Which items appear is decided by the tested pure helper `propertyRowActions`
 * (`lib/property-row-actions.ts`); this component only renders the sheet and
 * routes the choice. Every write belongs to the LIST screen, which owns
 * `useUpdateProperty` so the kebab and the edit form share one write path.
 *
 * Two web shapes are load-bearing and easy to "tidy" away:
 *   - **No `canManage` means no trigger at all**, not a disabled one. Web
 *     renders an empty `<span />` in that branch (`:313`); the screen already
 *     shows the `editor.admin_hint` line for those members, so an extra
 *     disabled button would be a second, emptier way of saying the same thing.
 *   - **Archive and restore are asymmetric.** Restore writes immediately;
 *     archive goes through the confirm the edit form also uses. See
 *     `propertyRowActionNeedsConfirm`.
 *
 * Differences from web that come from the platform, not a change of intent:
 *   - Web's menu carries no "Open in new tab" for properties (the row cell is
 *     the menu alone), so there is nothing to omit.
 *   - The sheet is `ActionSheet.showActionSheetWithOptions` (this app's native
 *     menu pattern) rather than a rendered dropdown.
 */
import { useCallback } from "react";
import type { IssueProperty } from "@multica/core/types";
import { IconButton } from "@/components/ui/icon-button";
import { ActionSheet } from "@/lib/action-sheet";
import {
  propertyRowActions,
  type PropertyRowAction,
} from "@/lib/property-row-actions";
import { useTranslation } from "@/lib/i18n/react";

const LABEL_KEY: Record<PropertyRowAction, string> = {
  // Web's `properties.actions.edit` / `.archive` / `.unarchive`. Mobile already
  // ships the archive/restore pair on the edit form's own toggle, so these are
  // the same two strings a user reads there — `properties.archive` /
  // `properties.restore`.
  edit: "properties.editProperty",
  archive: "properties.archive",
  restore: "properties.restore",
};

export function PropertyRowMenu({
  property,
  canManage,
  onEdit,
  onArchive,
  onRestore,
}: {
  property: IssueProperty;
  /** Web's `canManage` — owner/admin. No menu at all when false. */
  canManage: boolean;
  /** Push the shared edit form for this row. */
  onEdit: (row: IssueProperty) => void;
  /** Open the archive confirm for this row (web's `pendingArchive`). */
  onArchive: (row: IssueProperty) => void;
  /** Restore writes straight through — no confirm, as web does. */
  onRestore: (row: IssueProperty) => void;
}) {
  const { t } = useTranslation();
  const actions = propertyRowActions(property, { canManage });

  const openMenu = useCallback(() => {
    if (actions.length === 0) return;
    const labels = actions.map((action) => t(LABEL_KEY[action]));
    // Archive is the destructive entry; restore is an ordinary write. Web
    // marks only the archive item `variant="destructive"`.
    const destructiveButtonIndex = actions.indexOf("archive");
    ActionSheet.showActionSheetWithOptions(
      {
        title: property.name,
        options: [...labels, t("common.cancel")],
        cancelButtonIndex: labels.length,
        ...(destructiveButtonIndex >= 0 ? { destructiveButtonIndex } : {}),
      },
      (index) => {
        const action = actions[index];
        if (!action) return;
        if (action === "edit") onEdit(property);
        else if (action === "archive") onArchive(property);
        else onRestore(property);
      },
    );
  }, [actions, property, t, onEdit, onArchive, onRestore]);

  // Web's `canManage ? <DropdownMenu> : <span />` — no trigger for a member
  // without manage rights, rather than an empty sheet.
  if (actions.length === 0) return null;

  return (
    <IconButton
      name="ellipsis-horizontal"
      onPress={openMenu}
      accessibilityLabel={t("properties.actions.open", { name: property.name })}
    />
  );
}
