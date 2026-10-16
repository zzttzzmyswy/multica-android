/**
 * Projects-LIST row actions — the "⋯" every row gains in iteration 252
 * (MYS-2197), mirroring web's `ProjectRowActions`
 * (`packages/views/projects/components/projects-page.tsx:222-320`).
 *
 * `projects` was the last list surface without a kebab: the eight siblings
 * (agents, autopilots, labels, members, properties, skills, squads, runtimes)
 * each gained one in iterations 229-231. Before this round, pinning a project
 * or deleting one meant opening its detail page first.
 *
 * Which items appear is decided by the tested pure helper
 * `projectRowActions` (`lib/project-row-actions.ts`); this component only
 * renders the sheet and routes the choice. Every write belongs to the LIST
 * screen, which already owns the pin and delete paths for the batch toolbar, so
 * the kebab and the long-press toolbar cannot drift — the same split web has,
 * where `ProjectRowActions` and `ProjectBatchToolbar` mount one set of
 * mutations.
 *
 * Differences from web that come from the platform, not a change of intent:
 *   - Web's menu also carries "Open in new tab" (`:272`). A phone has no tabs
 *     and the row tap already opens the project, so it is omitted — the same
 *     reason `agent-row-menu.tsx`, `autopilot-row-menu.tsx`,
 *     `skill-row-menu.tsx` and `label-row-menu.tsx` omit it.
 *   - Web's delete opens a rendered `Dialog`; a phone confirms through the
 *     native `Alert`, which is what this app's destructive rows use (see
 *     `skill-row-menu.tsx`'s refresh confirm and the detail page's own delete).
 *     The confirm is owned by the screen so the kebab and the batch toolbar
 *     ask the same question.
 *   - The sheet is `ActionSheet.showActionSheetWithOptions` (this app's native
 *     menu pattern) rather than a rendered dropdown.
 */
import { useCallback } from "react";
import type { Project } from "@multica/core/types";
import { IconButton } from "@/components/ui/icon-button";
import { ActionSheet } from "@/lib/action-sheet";
import {
  PROJECT_ROW_ACTION_LABEL_KEY,
  projectRowActionsFor,
} from "@/lib/project-row-actions";
import { useTranslation } from "@/lib/i18n/react";

/** The menu's props minus the project, which each row supplies itself — the
 *  shape both list views take and hand to `<ProjectRowMenu>` per row. */
export type ProjectRowMenuProps = Omit<
  React.ComponentProps<typeof ProjectRowMenu>,
  "project"
>;

export function ProjectRowMenu({
  project,
  pinnedIds,
  pinsResolved,
  canDelete,
  onTogglePin,
  onDelete,
}: {
  project: Project;
  /** The viewer's pinned project ids, as the list already computes them. The
   *  row's direction is derived from membership — never from a locally
   *  defaulted empty set, which is what an unresolved read produces. */
  pinnedIds: ReadonlySet<string>;
  /** The pin list settled, so non-membership is measured, not unread. */
  pinsResolved: boolean;
  /** Workspace admin/owner — web's `isWorkspaceAdmin`. */
  canDelete: boolean;
  /** Pin or unpin this one row. Owned by the screen so the kebab and the batch
   *  toolbar take the identical write path. */
  onTogglePin: (project: Project, pinned: boolean) => void;
  /** Ask the shared delete confirmation for this row. The menu does not own the
   *  dialog: the toolbar confirms a whole selection through the same one. */
  onDelete: (project: Project) => void;
}) {
  const { t } = useTranslation();
  const actions = projectRowActionsFor(project, pinnedIds, pinsResolved, {
    canDelete,
  });
  const openMenu = useCallback(() => {
    if (actions.length === 0) return;
    const labels = actions.map((action) =>
      t(PROJECT_ROW_ACTION_LABEL_KEY[action]),
    );
    const destructiveButtonIndex = actions.indexOf("delete");
    ActionSheet.showActionSheetWithOptions(
      {
        title: project.title,
        options: [...labels, t("common.cancel")],
        cancelButtonIndex: labels.length,
        ...(destructiveButtonIndex >= 0 ? { destructiveButtonIndex } : {}),
      },
      (index) => {
        const action = actions[index];
        if (!action) return;
        if (action === "delete") onDelete(project);
        else onTogglePin(project, action === "unpin");
      },
    );
  }, [actions, project, t, onTogglePin, onDelete]);

  // No items to offer — a member whose pin list has not settled. The trigger is
  // hidden rather than opening a sheet with nothing but Cancel in it (the same
  // empty-return contract `runtimeRowActions` / `autopilotRowActions` have).
  if (actions.length === 0) return null;

  return (
    <IconButton
      name="ellipsis-horizontal"
      onPress={openMenu}
      accessibilityLabel={t("projects.rowMenu")}
    />
  );
}
