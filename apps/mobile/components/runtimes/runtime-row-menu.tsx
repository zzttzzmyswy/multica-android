/**
 * Machine-detail runtime row action menu (iteration 167; the edit entry added
 * in 176) — the "⋯" web's `RuntimeRowMenu` puts on every runtime row
 * (packages/views/runtimes/components/runtime-list.tsx).
 *
 * Which items appear is decided by the tested pure helper `runtimeRowActions`;
 * this component only renders the sheet, resolves the custom runtime's profile
 * so the edit form has something to open on, and runs the shared delete flow
 * (`use-runtime-delete-flow`) — the same confirmation, cascade warning and
 * conflict retries the detail page uses, so a destructive action reads
 * identically wherever it is reached from.
 */
import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { AgentRuntime, RuntimeProfile } from "@multica/core/types";
import { IconButton } from "@/components/ui/icon-button";
import { ActionSheet } from "@/lib/action-sheet";
import {
  runtimeDeleteConfirmLabelKey,
  runtimeRowActions,
  type RuntimeRowAction,
} from "@/lib/runtime-row-actions";
import { runtimeProfileListOptions } from "@/data/queries/runtime-profiles";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useRuntimeDeleteFlow } from "@/components/runtimes/use-runtime-delete-flow";
import { RuntimeProfilesDialog } from "@/components/runtimes/runtime-profiles-dialog";
import { useTranslation } from "@/lib/i18n/react";

const LABEL_KEY: Record<RuntimeRowAction, string> = {
  edit: "runtimes.row.edit",
  delete: "runtimes.row.delete",
  "delete-profile": "runtimes.row.deleteProfile",
};

export function RuntimeRowMenu({
  runtime,
  displayName,
  canDelete,
  activeAgents,
  refetchAgents,
}: {
  runtime: AgentRuntime;
  displayName: string;
  /** Workspace admin, or the runtime's own owner for a built-in runtime. */
  canDelete: boolean;
  activeAgents: readonly { id: string; name: string }[];
  refetchAgents?: () => void;
}) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const [editing, setEditing] = useState<RuntimeProfile | null>(null);
  // The edit form needs the whole profile, not just its id, and the row only
  // carries `profile_id`. Web reads the same workspace-scoped list
  // (`runtime-list.tsx:588`), so the row menu does the same rather than making
  // every caller thread a profile down.
  const { data: profiles } = useQuery(runtimeProfileListOptions(wsId));
  const profile =
    profiles?.find((p) => p.id === runtime.profile_id) ?? null;
  const actions = runtimeRowActions(runtime, {
    canDelete,
    canEdit: profile !== null,
  });
  const confirmLabel = t(runtimeDeleteConfirmLabelKey(runtime));

  const { requestDelete } = useRuntimeDeleteFlow({
    runtime,
    displayName,
    activeAgents,
    refetchAgents,
    // The machine page keeps its place — the deleted runtime simply drops out
    // of the list once the mutation invalidates it.
    onDeleted: () => Alert.alert(t("runtimes.detail.deleted")),
    confirmLabel,
  });

  const openMenu = useCallback(() => {
    if (actions.length === 0) return;
    const labels = actions.map((action) => t(LABEL_KEY[action]));
    const destructiveIndex = actions.findIndex((a) => a !== "edit");
    ActionSheet.showActionSheetWithOptions(
      {
        title: displayName,
        options: [...labels, t("common.cancel")],
        cancelButtonIndex: labels.length,
        // Only mark a destructive button when there is one: with edit alone
        // the index would be -1, which some sheets read as "the last item".
        ...(destructiveIndex === -1
          ? {}
          : { destructiveButtonIndex: destructiveIndex }),
      },
      (index) => {
        const action = actions[index];
        if (action === "edit") {
          if (profile) setEditing(profile);
          return;
        }
        if (action === "delete" || action === "delete-profile") {
          requestDelete();
        }
      },
    );
  }, [actions, t, displayName, profile, requestDelete]);

  // No kebab when there is nothing to offer: an empty sheet reads as "I lost
  // my permission" rather than "there is nothing here".
  if (actions.length === 0) return null;

  return (
    <>
      <IconButton
        name="ellipsis-horizontal"
        iconSize={16}
        // Tighter than the default 40pt icon button so the kebab sits inside a
        // list row next to the row's chevron without crowding it.
        className="h-7 w-7"
        accessibilityLabel={t("runtimes.row.actions")}
        onPress={openMenu}
      />
      {editing ? (
        <RuntimeProfilesDialog
          intent="edit"
          initialProfile={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
