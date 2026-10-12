/**
 * Squads-LIST row actions — the "⋯" each manageable row gained in iteration 231
 * (MYS-2102), mirroring web's `SquadRowActions`
 * (`packages/views/squads/components/squads-page.tsx:320-374`).
 *
 * Before this round the row's only exit was `router.push` to the squad detail
 * page, so archiving this deployment's one squad meant opening it first.
 *
 * Which items appear is decided by the tested pure helper `squadRowActions`
 * (`lib/squad-row-actions.ts`); this component only renders the sheet and routes
 * the choice. The write belongs to the LIST screen, which owns `useDeleteSquad`
 * so the kebab and the detail page cannot drift on what "archive" does.
 *
 * Web's menu also carries "Open in new tab" (`:339-352`). A phone has no tabs
 * and the row tap already opens the squad, so it is omitted — the same reason
 * the other three surfaces this round omit it. There is no restore entry: the
 * server has no un-archive endpoint, so web has none either.
 *
 * The sheet is `ActionSheet.showActionSheetWithOptions` (this app's native menu
 * pattern) rather than a rendered dropdown.
 */
import { useCallback } from "react";
import type { Squad } from "@multica/core/types";
import { IconButton } from "@/components/ui/icon-button";
import { ActionSheet } from "@/lib/action-sheet";
import { squadRowActions, type SquadRowAction } from "@/lib/squad-row-actions";
import { useTranslation } from "@/lib/i18n/react";

const LABEL_KEY: Record<SquadRowAction, string> = {
  // Web's `page.archive_action` ("归档" / "Archive"), which is also what the
  // detail page's own archive entry renders — one verb for one action.
  archive: "squads.detail.archive",
};

export function SquadRowMenu({
  squad,
  currentRole,
  currentUserId,
  onArchive,
}: {
  squad: Squad;
  /** Role of the current user's own workspace membership row. */
  currentRole: "owner" | "admin" | "member" | null | undefined;
  /** Current user's User UUID — the creator half of the gate (MUL-4223). */
  currentUserId: string | null | undefined;
  /** Open the archive confirm for this row. The menu does not own the dialog:
   *  the screen confirms it through the copy web's `ArchiveSquadDialog` uses. */
  onArchive: (row: Squad) => void;
}) {
  const { t } = useTranslation();
  const actions = squadRowActions(squad, { currentRole, currentUserId });

  const openMenu = useCallback(() => {
    if (actions.length === 0) return;
    const labels = actions.map((action) => t(LABEL_KEY[action]));
    ActionSheet.showActionSheetWithOptions(
      {
        title: squad.name,
        options: [...labels, t("common.cancel")],
        cancelButtonIndex: labels.length,
        destructiveButtonIndex: 0,
      },
      (index) => {
        const action = actions[index];
        if (action === "archive") onArchive(squad);
      },
    );
  }, [actions, squad, t, onArchive]);

  // Not manageable by this viewer — web renders nothing in that cell
  // (`:1020-1022`), and the screen-level `isAdmin || creator` split means a
  // member's own squads get a kebab while everyone else's do not.
  if (actions.length === 0) return null;

  return (
    <IconButton
      name="ellipsis-horizontal"
      onPress={openMenu}
      accessibilityLabel={t("squads.actions.open")}
    />
  );
}
