/**
 * Machine-detail runtime row action menu (iteration 167) — the "⋯" web's
 * `RuntimeRowMenu` puts on every runtime row
 * (packages/views/runtimes/components/runtime-list.tsx). Before this, deleting
 * a runtime from a machine page meant tapping through to its detail screen;
 * web lets you do it from the row.
 *
 * Which items appear is decided by the tested pure helper
 * `runtimeRowActions`; this component only renders the sheet and runs the
 * shared delete flow (`use-runtime-delete-flow`) — the same confirmation,
 * cascade warning and conflict retries the detail page uses, so a destructive
 * action reads identically wherever it is reached from.
 */
import { useCallback } from "react";
import { Alert } from "react-native";
import type { AgentRuntime } from "@multica/core/types";
import { IconButton } from "@/components/ui/icon-button";
import { ActionSheet } from "@/lib/action-sheet";
import {
  runtimeDeleteConfirmLabelKey,
  runtimeRowActions,
  type RuntimeRowAction,
} from "@/lib/runtime-row-actions";
import { useRuntimeDeleteFlow } from "@/components/runtimes/use-runtime-delete-flow";
import { useTranslation } from "@/lib/i18n/react";

const LABEL_KEY: Record<RuntimeRowAction, string> = {
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
  const actions = runtimeRowActions(runtime, { canDelete });
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
    ActionSheet.showActionSheetWithOptions(
      {
        title: displayName,
        options: [...labels, t("common.cancel")],
        cancelButtonIndex: labels.length,
        destructiveButtonIndex: 0,
      },
      (index) => {
        if (actions[index] !== "delete" && actions[index] !== "delete-profile") return;
        requestDelete();
      },
    );
  }, [actions, t, displayName, requestDelete]);

  // No kebab when there is nothing to offer: an empty sheet reads as "I lost
  // my permission" rather than "there is nothing here".
  if (actions.length === 0) return null;

  return (
    <IconButton
      name="ellipsis-horizontal"
      iconSize={16}
      // Tighter than the default 40pt icon button so the kebab sits inside a
      // list row next to the row's chevron without crowding it.
      className="h-7 w-7"
      accessibilityLabel={t("runtimes.row.actions")}
      onPress={openMenu}
    />
  );
}
