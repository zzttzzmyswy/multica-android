/**
 * Skills-LIST row actions — the "⋯" every row gained in iteration 230
 * (MYS-2097), mirroring web's `SkillRowActions`
 * (`packages/views/skills/components/skill-list-actions.tsx:537-614`).
 *
 * Before this round the only way to refresh a skill or attach one to an agent
 * from the list was to open its detail page first. On this deployment 18 of the
 * 27 skills are GitHub-sourced with a `source_url`, so all 18 rows get a
 * "refresh" in web's kebab while the phone offered none.
 *
 * Which items appear is decided by the tested pure helper `skillRowActions`
 * (`lib/skill-row-actions.ts`); this component only renders the sheet and routes
 * the choice. Every write belongs to the LIST screen, which owns the refresh and
 * delete mutations so the kebab, the batch bar and the shared add-to-agent sheet
 * share one write path — the split web has, where the dialogs are defined once
 * and mounted by both `SkillRowActions` and `SkillBatchToolbar`.
 *
 * Differences from web that come from the platform, not a change of intent:
 *   - Web's menu also carries "Open in new tab" (`:557`). A phone has no tabs
 *     and the row tap already opens the skill, so it is omitted — the same
 *     reason `agent-row-menu.tsx` and `autopilot-row-menu.tsx` omit it.
 *   - The sheet is `ActionSheet.showActionSheetWithOptions` (this app's native
 *     menu pattern, as the agents and autopilots lists use) rather than a
 *     rendered dropdown.
 */
import { useCallback } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { ActionSheet } from "@/lib/action-sheet";
import type { SkillRow } from "@/lib/filter-skills";
import {
  skillRowActions,
  type SkillRowAction,
} from "@/lib/skill-row-actions";
import { useTranslation } from "@/lib/i18n/react";

const LABEL_KEY: Record<SkillRowAction, string> = {
  // Web's `actions.add_to_agent` / `actions.refresh` / `actions.delete`. The
  // first two reuse the keys the same surfaces already render elsewhere
  // (`skills.usedBy.add` on the batch bar and the detail page,
  // `skills.detail.refresh` on the detail page) so one action reads the same
  // way wherever it is reached from; `delete` is web's shorter verb.
  "add-to-agent": "skills.usedBy.add",
  refresh: "skills.detail.refresh",
  delete: "skills.actions.delete",
};

export function SkillRowMenu({
  row,
  onAddToAgent,
  onRefresh,
  onDelete,
}: {
  row: SkillRow;
  /** Open the shared add-to-agent sheet for this row. */
  onAddToAgent: (row: SkillRow) => void;
  /** Confirm-and-refresh this one row. Owned by the screen so the confirm copy
   *  and the mutation are the ones the detail page already uses. */
  onRefresh: (row: SkillRow) => void;
  /** Open the delete confirm for this row. The menu does not own the dialog:
   *  the batch bar confirms a whole selection through the same copy. */
  onDelete: (row: SkillRow) => void;
}) {
  const { t } = useTranslation();
  const actions = skillRowActions(row);

  const openMenu = useCallback(() => {
    if (actions.length === 0) return;
    const labels = actions.map((action) => t(LABEL_KEY[action]));
    const destructiveButtonIndex = actions.indexOf("delete");
    ActionSheet.showActionSheetWithOptions(
      {
        title: row.skill.name,
        options: [...labels, t("common.cancel")],
        cancelButtonIndex: labels.length,
        ...(destructiveButtonIndex >= 0 ? { destructiveButtonIndex } : {}),
      },
      (index) => {
        const action = actions[index];
        if (!action) return;
        if (action === "add-to-agent") onAddToAgent(row);
        else if (action === "refresh") onRefresh(row);
        else onDelete(row);
      },
    );
  }, [actions, row, t, onAddToAgent, onRefresh, onDelete]);

  // No items to offer. `skillRowActions` returns `add-to-agent` for every row,
  // so this is unreachable today and is kept only so a future gate that removes
  // the last item hides the trigger instead of opening an empty sheet.
  if (actions.length === 0) return null;

  return (
    <IconButton
      name="ellipsis-horizontal"
      onPress={openMenu}
      accessibilityLabel={t("skills.actions.row_menu")}
    />
  );
}
