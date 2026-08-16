/**
 * Agent detail action menu — the "⋯" entry in the detail header row. Mirrors
 * web's `agent-detail-page.tsx` management surface: Edit / Environment /
 * Archive|Restore, with an archive confirmation dialog (web's archive_dialog)
 * and the archived→restore flip.
 *
 * Feedback follows the mobile pattern (native Alert, no toast infra):
 *  - Archive/restore success needs no toast — the archived banner appearing
 *    / disappearing IS the feedback.
 *  - Failures surface as an Alert so a 403 (non-owner attempting to change
 *    access elsewhere) never passes silently.
 */
import { useCallback } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import type { Agent } from "@multica/core/types";
import { IconButton } from "@/components/ui/icon-button";
import { ActionSheet } from "@/lib/action-sheet";
import { useArchiveAgent, useRestoreAgent } from "@/data/mutations/agents";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";

export function AgentDetailActions({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const archiveAgent = useArchiveAgent();
  const restoreAgent = useRestoreAgent();

  const archived =
    !!agent.archived_at || String(agent.status) === "archived";

  const openMenu = useCallback(() => {
    const options: string[] = [];
    const actions: ("edit" | "env" | "archive" | "restore" | "cancel")[] = [];
    const push = (label: string, action: "edit" | "env" | "archive" | "restore" | "cancel") => {
      options.push(label);
      actions.push(action);
    };

    push(t("agents.detail.menu.edit"), "edit");
    push(t("agents.detail.menu.env"), "env");
    if (archived) push(t("agents.detail.menu.restore"), "restore");
    else push(t("agents.detail.menu.archive"), "archive");
    push(t("menu.cancel"), "cancel");

    const cancelButtonIndex = options.length - 1;
    const destructiveButtonIndex = archived ? undefined : actions.indexOf("archive");

    ActionSheet.showActionSheetWithOptions(
      {
        title: agent.name,
        options,
        cancelButtonIndex,
        ...(destructiveButtonIndex !== undefined && destructiveButtonIndex >= 0
          ? { destructiveButtonIndex }
          : {}),
      },
      (index) => {
        const action = actions[index];
        if (!action || action === "cancel" || !wsSlug) return;

        const nav = (route: "edit" | "env") =>
          router.push(`/${wsSlug}/more/agents/${agent.id}/${route}`);

        switch (action) {
          case "edit":
            nav("edit");
            return;
          case "env":
            nav("env");
            return;
          case "restore":
            restoreAgent.mutate(agent.id, {
              onError: (err) =>
                Alert.alert(
                  t("agents.detail.restoreFailedTitle"),
                  err instanceof Error && err.message
                    ? err.message
                    : t("agents.detail.restoreFailedMessage"),
                ),
            });
            return;
          case "archive":
            Alert.alert(
              t("agents.detail.archiveTitle"),
              t("agents.detail.archiveMessage", { name: agent.name }),
              [
                { text: t("menu.cancel"), style: "cancel" },
                {
                  text: t("agents.detail.menu.archive"),
                  style: "destructive",
                  onPress: () =>
                    archiveAgent.mutate(agent.id, {
                      onError: (err) =>
                        Alert.alert(
                          t("agents.detail.archiveFailedTitle"),
                          err instanceof Error && err.message
                            ? err.message
                            : t("agents.detail.archiveFailedMessage"),
                        ),
                    }),
                },
              ],
            );
        }
      },
    );
  }, [t, wsSlug, agent, archived, archiveAgent, restoreAgent]);

  return (
    <IconButton
      name="ellipsis-horizontal"
      iconSize={20}
      accessibilityLabel={t("a11y.agentActions")}
      onPress={openMenu}
    />
  );
}