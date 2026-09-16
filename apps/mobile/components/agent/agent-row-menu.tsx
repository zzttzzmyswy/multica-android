/**
 * Agents-LIST row action menu — the "⋯" the list rows gained in iteration
 * 129 (MYS-1060), mirroring web's `AgentRowActions`
 * (packages/views/agents/components/agent-row-actions.tsx).
 *
 * Which items appear is decided by the tested pure helper
 * `agentRowActions` (lib/agent-row-actions.ts); this component only renders
 * the sheet and runs the chosen mutation. The confirmation copy, mutation
 * hooks and failure alerts are the same ones the detail page's menu uses
 * (`agent-detail-actions.tsx`) so a destructive action reads identically
 * wherever it is reached from.
 *
 * Archive and cancel-tasks take a second confirmation (native Alert, the
 * mobile pattern — no toast infra); restore and duplicate act immediately,
 * matching web's row menu.
 */
import { useCallback } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import type { Agent } from "@multica/core/types";
import type { AgentPresenceDetail } from "@multica/core/agents";
import { IconButton } from "@/components/ui/icon-button";
import { ActionSheet } from "@/lib/action-sheet";
import {
  agentRowActions,
  describeCancelImpact,
  type AgentRowAction,
} from "@/lib/agent-row-actions";
import {
  useArchiveAgent,
  useCancelAgentTasks,
  useRestoreAgent,
} from "@/data/mutations/agents";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";

export function AgentRowMenu({
  agent,
  presence,
  canManage,
}: {
  agent: Agent;
  presence: AgentPresenceDetail | undefined;
  /** Workspace admin/owner, or the agent's own owner. */
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const archiveAgent = useArchiveAgent();
  const restoreAgent = useRestoreAgent();
  const cancelTasks = useCancelAgentTasks();

  const runningCount = presence?.runningCount ?? 0;
  const queuedCount = presence?.queuedCount ?? 0;
  const actions = agentRowActions(agent, {
    canManage,
    hasActiveWork: runningCount + queuedCount > 0,
  });

  const openMenu = useCallback(() => {
    if (actions.length === 0) return;
    const labels = actions.map((action) => t(LABEL_KEY[action]));
    const cancelLabel = t("common.cancel");
    const cancelButtonIndex = labels.length;
    const destructiveButtonIndex = actions.indexOf("archive");

    ActionSheet.showActionSheetWithOptions(
      {
        title: agent.name,
        options: [...labels, cancelLabel],
        cancelButtonIndex,
        ...(destructiveButtonIndex >= 0 ? { destructiveButtonIndex } : {}),
      },
      (index) => {
        const action = actions[index];
        if (!action || !wsSlug) return;

        const failAlert = (title: string, message: string) => (err: unknown) =>
          Alert.alert(
            title,
            err instanceof Error && err.message ? err.message : message,
          );

        switch (action) {
          case "duplicate":
            // Straight to the manual form: a duplicate has every field
            // decided, so the create-method chooser would be a step with
            // nothing to choose (web agents-page.tsx:973-978).
            router.push(
              `/${wsSlug}/more/agents/new/manual?duplicate=${agent.id}`,
            );
            return;
          case "restore":
            restoreAgent.mutate(agent.id, {
              onError: failAlert(
                t("agents.detail.restoreFailedTitle"),
                t("agents.detail.restoreFailedMessage"),
              ),
            });
            return;
          case "cancel-tasks":
            Alert.alert(
              t("agents.detail.cancelTitle", { name: agent.name }),
              describeCancelImpact(runningCount, queuedCount, t),
              [
                { text: t("agents.detail.cancelKeep"), style: "cancel" },
                {
                  text: t("agents.detail.cancelConfirm"),
                  style: "destructive",
                  onPress: () =>
                    cancelTasks.mutate(agent.id, {
                      onSuccess: (res) =>
                        Alert.alert(
                          res.cancelled === 1
                            ? t("agents.detail.cancelSuccessOne", {
                                count: res.cancelled,
                              })
                            : t("agents.detail.cancelSuccessOther", {
                                count: res.cancelled,
                              }),
                        ),
                      onError: failAlert(
                        t("agents.detail.cancelFailedTitle"),
                        t("agents.detail.cancelFailedMessage"),
                      ),
                    }),
                },
              ],
            );
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
                      onError: failAlert(
                        t("agents.detail.archiveFailedTitle"),
                        t("agents.detail.archiveFailedMessage"),
                      ),
                    }),
                },
              ],
            );
        }
      },
    );
  }, [
    actions,
    t,
    wsSlug,
    agent.id,
    agent.name,
    runningCount,
    queuedCount,
    archiveAgent,
    restoreAgent,
    cancelTasks,
  ]);

  // Nothing to offer this row (e.g. an archived agent you don't manage) —
  // the trigger is hidden rather than opening an empty sheet.
  if (actions.length === 0) return null;

  return (
    <IconButton
      name="ellipsis-horizontal"
      accessibilityLabel={t("a11y.agentActions")}
      onPress={openMenu}
    />
  );
}

const LABEL_KEY: Record<AgentRowAction, string> = {
  "cancel-tasks": "agents.detail.cancelMenu",
  duplicate: "agents.rowActions.duplicate",
  restore: "agents.detail.menu.restore",
  archive: "agents.detail.menu.archive",
};
