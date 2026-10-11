/**
 * Autopilots-LIST row actions — the "⋯" each row gained in iteration 229
 * (MYS-2096), mirroring web's `AutopilotRowActions`
 * (`packages/views/autopilots/components/autopilot-list-actions.tsx:143-211`).
 *
 * Before this round the only way to pause, resume or delete an autopilot from
 * the list was to open its detail page and use the switch / ActionSheet there.
 * On a deployment with 19 autopilots (14 active, 5 paused) that is one
 * navigation per status change.
 *
 * Which items appear is decided by the tested pure helper
 * `autopilotRowActions` (`lib/autopilot-list-actions.ts`); this component only
 * renders the sheet and routes the choice. The writes belong to the LIST
 * screen, which owns `useUpdateAutopilot` / `useDeleteAutopilot` so the kebab
 * and the batch toolbar share one write path — the same split web has, where
 * `useSetStatus` is defined once and used by both `AutopilotRowActions` and
 * `AutopilotBatchToolbar`.
 *
 * Differences from web that come from the platform, not a change of intent:
 *   - Web's menu also carries "Open in new tab" (`:175`). A phone has no tabs
 *     and the row tap already opens the autopilot, so it is omitted — the same
 *     reason `agent-row-menu.tsx` omits it.
 *   - The sheet is `ActionSheet.showActionSheetWithOptions` (this app's native
 *     menu pattern, as the agents list uses) rather than a rendered dropdown.
 */
import { useCallback } from "react";
import type { Autopilot } from "@multica/core/types";
import { IconButton } from "@/components/ui/icon-button";
import { ActionSheet } from "@/lib/action-sheet";
import {
  autopilotRowActions,
  type AutopilotRowAction,
} from "@/lib/autopilot-list-actions";
import { useTranslation } from "@/lib/i18n/react";

const LABEL_KEY: Record<AutopilotRowAction, string> = {
  pause: "autopilots.actions.pause",
  resume: "autopilots.actions.resume",
  delete: "autopilots.actions.delete",
};

export function AutopilotRowMenu({
  autopilot,
  onStatusChange,
  onDelete,
}: {
  autopilot: Autopilot;
  /** Pause / resume this one row. Owned by the screen so the toolbar's batch
   *  status write and this one cannot drift. */
  onStatusChange: (row: Autopilot, status: "active" | "paused") => void;
  /** Open the shared delete confirm for this row. The menu does not own the
   *  dialog: the batch toolbar confirms a whole selection through the same one. */
  onDelete: (row: Autopilot) => void;
}) {
  const { t } = useTranslation();
  const actions = autopilotRowActions(autopilot);

  const openMenu = useCallback(() => {
    if (actions.length === 0) return;
    const labels = actions.map((action) => t(LABEL_KEY[action]));
    const destructiveButtonIndex = actions.indexOf("delete");
    ActionSheet.showActionSheetWithOptions(
      {
        title: autopilot.title,
        options: [...labels, t("common.cancel")],
        cancelButtonIndex: labels.length,
        ...(destructiveButtonIndex >= 0 ? { destructiveButtonIndex } : {}),
      },
      (index) => {
        const action = actions[index];
        if (!action) return;
        if (action === "delete") onDelete(autopilot);
        else onStatusChange(autopilot, action === "pause" ? "paused" : "active");
      },
    );
  }, [actions, autopilot, t, onStatusChange, onDelete]);

  // No items to offer — a member without write. The trigger is hidden rather
  // than opening an empty sheet (web returns `null` from the whole component).
  if (actions.length === 0) return null;

  return (
    <IconButton
      name="ellipsis-horizontal"
      onPress={openMenu}
      accessibilityLabel={t("autopilots.actions.row_menu")}
    />
  );
}
