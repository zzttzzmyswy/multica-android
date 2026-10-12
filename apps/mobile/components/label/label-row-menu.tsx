/**
 * Labels-LIST row actions — the "⋯" every row gained in iteration 231
 * (MYS-2102), mirroring web's row menu
 * (`packages/views/settings/components/labels-tab.tsx:186-211`).
 *
 * Before this round the row's only exit was `router.push` to the edit form, so
 * renaming or deleting one of this deployment's three labels meant opening it
 * first.
 *
 * Which items appear is decided by the tested pure helper `labelRowActions`
 * (`lib/label-row-actions.ts`); this component only renders the sheet and routes
 * the choice. Every write belongs to the LIST screen, which owns the update and
 * delete mutations so the kebab and the edit form share one write path — the
 * split web has, where the dialogs are defined once and mounted by both the row
 * menu and the form.
 *
 * Note what is NOT here: a permission gate. Web's labels tab has none (see the
 * helper's header), so neither does this. Do not "fix" that by adding
 * `canManage` — the properties tab next door gates its menu and labels
 * deliberately do not.
 *
 * Differences from web that come from the platform, not a change of intent:
 *   - Web's menu carries no "Open in new tab" for labels (unlike the other
 *     three surfaces this round), so there is nothing to omit.
 *   - The sheet is `ActionSheet.showActionSheetWithOptions` (this app's native
 *     menu pattern) rather than a rendered dropdown.
 */
import { useCallback } from "react";
import type { Label } from "@multica/core/types";
import { IconButton } from "@/components/ui/icon-button";
import { ActionSheet } from "@/lib/action-sheet";
import { labelRowActions, type LabelRowAction } from "@/lib/label-row-actions";
import { useTranslation } from "@/lib/i18n/react";

const LABEL_KEY: Record<LabelRowAction, string> = {
  // Web's `labels.actions.edit` / `labels.actions.delete`. `edit` reuses the
  // key the edit form's own header uses; `delete` is the verb the form's
  // delete row already renders, so one action reads the same way wherever it
  // is reached from.
  edit: "labels.edit.title",
  delete: "labels.delete",
};

export function LabelRowMenu({
  label,
  onEdit,
  onDelete,
}: {
  label: Label;
  /** Push the shared edit form for this row. Owned by the screen so the kebab
   *  and the list's own row tap take the identical route. */
  onEdit: (row: Label) => void;
  /** Open the delete confirm for this row. The menu does not own the dialog:
   *  the copy is the one the edit form already uses. */
  onDelete: (row: Label) => void;
}) {
  const { t } = useTranslation();
  const actions = labelRowActions(label);

  const openMenu = useCallback(() => {
    if (actions.length === 0) return;
    const labels = actions.map((action) => t(LABEL_KEY[action]));
    const destructiveButtonIndex = actions.indexOf("delete");
    ActionSheet.showActionSheetWithOptions(
      {
        title: label.name,
        options: [...labels, t("common.cancel")],
        cancelButtonIndex: labels.length,
        ...(destructiveButtonIndex >= 0 ? { destructiveButtonIndex } : {}),
      },
      (index) => {
        const action = actions[index];
        if (!action) return;
        if (action === "edit") onEdit(label);
        else onDelete(label);
      },
    );
  }, [actions, label, t, onEdit, onDelete]);

  // No items to offer. `labelRowActions` is unconditional today, so this is
  // unreachable and is kept only so a future gate that removes the last item
  // hides the trigger instead of opening an empty sheet.
  if (actions.length === 0) return null;

  return (
    <IconButton
      name="ellipsis-horizontal"
      onPress={openMenu}
      accessibilityLabel={t("labels.actions.open", { name: label.name })}
    />
  );
}
