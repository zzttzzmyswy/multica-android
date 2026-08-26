/**
 * Agent detail action menu — the "⋯" entry in the detail header row. Mirrors
 * web's `agent-detail-page.tsx` management surface: Edit / Environment /
 * Archive|Restore, with an archive confirmation dialog (web's archive_dialog)
 * and the archived→restore flip.
 *
 * "Cancel all tasks" (web parity: agent-row-actions showStop) appears while
 * the agent has active work (running + queued > 0, read from the workspace
 * presence map the detail page already derives). Confirmation is a native
 * Alert mirroring web's cancel_dialog (counts + 5s halt note + irreversible
 * note); success/failure surface as Alerts (mobile pattern, no toast infra).
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
import type { AgentPresenceDetail } from "@multica/core/agents";
import { IconButton } from "@/components/ui/icon-button";
import { ActionSheet } from "@/lib/action-sheet";
import {
  useArchiveAgent,
  useCancelAgentTasks,
  useRestoreAgent,
} from "@/data/mutations/agents";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";

type DetailAction =
  | "edit"
  | "env"
  | "args"
  | "integrations"
  | "archive"
  | "restore"
  | "cancel-tasks"
  | "cancel";

export function AgentDetailActions({
  agent,
  presence,
}: {
  agent: Agent;
  presence?: AgentPresenceDetail;
}) {
  const { t } = useTranslation();
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const archiveAgent = useArchiveAgent();
  const restoreAgent = useRestoreAgent();
  const cancelTasks = useCancelAgentTasks();

  const archived =
    !!agent.archived_at || String(agent.status) === "archived";
  const runningCount = presence?.runningCount ?? 0;
  const queuedCount = presence?.queuedCount ?? 0;
  const hasActiveWork = runningCount + queuedCount > 0;

  const openMenu = useCallback(() => {
    const options: string[] = [];
    const actions: DetailAction[] = [];
    const push = (label: string, action: DetailAction) => {
      options.push(label);
      actions.push(action);
    };

    push(t("agents.detail.menu.edit"), "edit");
    push(t("agents.detail.menu.env"), "env");
    push(t("agents.detail.menu.args"), "args");
    push(t("agents.detail.menu.integrations"), "integrations");
    if (!archived && hasActiveWork) {
      push(t("agents.detail.cancelMenu"), "cancel-tasks");
    }
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

        const nav = (route: "edit" | "env" | "custom-args" | "integrations") =>
          router.push(`/${wsSlug}/more/agents/${agent.id}/${route}`);

        switch (action) {
          case "edit":
            nav("edit");
            return;
          case "env":
            nav("env");
            return;
          case "args":
            nav("custom-args");
            return;
          case "integrations":
            nav("integrations");
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
                      onSuccess: (res) => {
                        if (res.cancelled === 0) {
                          Alert.alert(t("agents.detail.cancelNoTasks"));
                          return;
                        }
                        Alert.alert(
                          res.cancelled === 1
                            ? t("agents.detail.cancelSuccessOne", { count: res.cancelled })
                            : t("agents.detail.cancelSuccessOther", { count: res.cancelled }),
                        );
                      },
                      onError: (err) =>
                        Alert.alert(
                          t("agents.detail.cancelFailedTitle"),
                          err instanceof Error && err.message
                            ? err.message
                            : t("agents.detail.cancelFailedMessage"),
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
  }, [t, wsSlug, agent, archived, runningCount, queuedCount, hasActiveWork, archiveAgent, restoreAgent, cancelTasks]);

  return (
    <IconButton
      name="ellipsis-horizontal"
      iconSize={20}
      accessibilityLabel={t("a11y.agentActions")}
      onPress={openMenu}
    />
  );
}

type T = ReturnType<typeof useTranslation>["t"];

// Web-parity impact copy (agent-row-actions describeCancelImpact): "This will
// cancel 2 running + 1 queued tasks." — running note only when tasks are
// running (queued-only cancels are instant).
function describeCancelImpact(
  running: number,
  queued: number,
  t: T,
): string {
  if (running === 0 && queued === 0) return t("agents.detail.cancelNoTasks");
  const parts: string[] = [];
  if (running > 0) {
    parts.push(t("agents.detail.cancelRunningCount", { count: running }));
  }
  if (queued > 0) {
    parts.push(t("agents.detail.cancelQueuedCount", { count: queued }));
  }
  const summary = parts.join(" + ");
  const total = running + queued;
  const impact =
    total === 1
      ? t("agents.detail.cancelImpactOne", { summary })
      : t("agents.detail.cancelImpactOther", { summary });
  const note = running > 0 ? t("agents.detail.cancelRunningNote") : "";
  return [impact, note, t("agents.detail.cancelIrreversible")].join("\n\n");
}
