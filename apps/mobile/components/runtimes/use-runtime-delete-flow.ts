/**
 * The runtime delete flow (iteration 167) — extracted from the runtime detail
 * page so the machine-detail row menu can offer the same destructive action
 * without a second copy of the conflict handling.
 *
 * The flow is not just "call delete": the server refuses to delete a runtime
 * that still has agents bound (`runtime_has_active_agents`) and refuses again
 * if the bound set changed between the confirmation and the call
 * (`runtime_delete_plan_changed`). Both are answered by re-confirming against
 * the server's authoritative agent list and retrying as an unbind-and-delete —
 * web's DeleteRuntimeDialog does the same two-step
 * (packages/views/runtimes/components/delete-runtime-dialog.tsx).
 *
 * Copy comes from the detail page's existing keys so the same destructive
 * action reads identically wherever it is reached from; only the button label
 * differs (a row menu says "Delete" / "Delete from workspace", a detail page
 * says "Delete runtime").
 */
import { useCallback } from "react";
import { Alert } from "react-native";
import type { AgentRuntime } from "@multica/core/types";
import {
  useDeleteRuntime,
  useUnbindAgentsAndDeleteRuntime,
} from "@/data/mutations/runtimes";
import { isSelfHealingRuntime, parseActiveAgentsConflict } from "@/lib/runtime-management";
import { useTranslation } from "@/lib/i18n/react";

export interface RuntimeDeleteFlowOptions {
  /**
   * The runtime to delete, or null while it is still loading / not found. The
   * hook must be callable unconditionally (React's rules-of-hooks), so a null
   * runtime yields a flow whose `requestDelete` is a no-op rather than a
   * separate code path.
   */
  runtime: AgentRuntime | null;
  /** Name shown in the confirmation copy (the viewer's label, not `name`). */
  displayName: string;
  /** Agents still bound to the runtime — the cascade plan's baseline. */
  activeAgents: readonly { id: string; name: string }[];
  /**
   * Refetch the agent list before a retry, so a plan-changed conflict is
   * re-confirmed against fresh data rather than the stale list that caused it.
   */
  refetchAgents?: () => void;
  /** Called once the runtime is gone (detail page pops, row menu stays put). */
  onDeleted: () => void;
  /** Destructive button label — "Delete runtime" vs "Delete from workspace". */
  confirmLabel: string;
}

export interface RuntimeDeleteFlow {
  /** Open the confirmation (or the cascade warning) for this runtime. */
  requestDelete: () => void;
  isPending: boolean;
}

export function useRuntimeDeleteFlow({
  runtime,
  displayName,
  activeAgents,
  refetchAgents,
  onDeleted,
  confirmLabel,
}: RuntimeDeleteFlowOptions): RuntimeDeleteFlow {
  const { t } = useTranslation();
  const deleteRuntime = useDeleteRuntime();
  const unbindDelete = useUnbindAgentsAndDeleteRuntime();

  const unknown = t("runtimes.detail.unknown");
  const cancelLabel = t("runtimes.detail.renameCancel");
  const runtimeId = runtime?.id ?? null;
  const selfHeal = runtime ? isSelfHealingRuntime(runtime) : false;

  const failureMessage = useCallback(
    (err: unknown) => (err instanceof Error ? err.message : unknown),
    [unknown],
  );

  const buildLightMessage = useCallback(() => {
    const parts = [t("runtimes.detail.deleteConfirmMessage", { name: displayName })];
    if (selfHeal) parts.push(t("runtimes.detail.selfHealHint"));
    return parts.join("\n\n");
  }, [t, displayName, selfHeal]);

  const buildCascadeMessage = useCallback(
    (plan: readonly { id: string; name: string }[]) => {
      const names = plan
        .slice(0, 8)
        .map((a) => a.name)
        .join("、");
      const parts = [
        t("runtimes.detail.deleteWithAgentsMessage", {
          count: plan.length,
          name: displayName,
        }),
        t("runtimes.detail.deleteBanner"),
        names,
      ];
      if (selfHeal) parts.push(t("runtimes.detail.selfHealHint"));
      return parts.join("\n\n");
    },
    [t, displayName, selfHeal],
  );

  const runUnbindDelete = useCallback(
    (agentIds: string[]) => {
      if (!runtimeId) return;
      unbindDelete.mutate(
        { runtimeId, expectedActiveAgentIds: agentIds },
        {
          onSuccess: onDeleted,
          onError: (err) => {
            const conflict = parseActiveAgentsConflict(err);
            if (conflict?.code === "runtime_delete_plan_changed") {
              // The bound set moved under us — refresh and force a
              // re-confirm against the server's authoritative snapshot.
              refetchAgents?.();
              Alert.alert(
                t("runtimes.detail.deleteWithAgentsTitle"),
                `${t("runtimes.detail.planChangedRetry")}\n\n${buildCascadeMessage(
                  conflict.activeAgents,
                )}`,
                [
                  { text: cancelLabel, style: "cancel" },
                  {
                    text: confirmLabel,
                    style: "destructive",
                    onPress: () =>
                      runUnbindDelete(conflict.activeAgents.map((a) => a.id)),
                  },
                ],
              );
              return;
            }
            Alert.alert(t("runtimes.detail.deleteFailed"), failureMessage(err));
          },
        },
      );
    },
    [
      unbindDelete,
      runtimeId,
      onDeleted,
      refetchAgents,
      t,
      buildCascadeMessage,
      cancelLabel,
      confirmLabel,
      failureMessage,
    ],
  );

  const confirmLightDelete = useCallback(() => {
    if (!runtimeId) return;
    deleteRuntime.mutate(runtimeId, {
      onSuccess: onDeleted,
      onError: (err) => {
        const conflict = parseActiveAgentsConflict(err);
        if (conflict?.code === "runtime_has_active_agents") {
          // Agents were bound between dialog-open and confirm — pivot to the
          // cascade flow with the server's authoritative list.
          Alert.alert(
            t("runtimes.detail.deleteWithAgentsTitle"),
            buildCascadeMessage(conflict.activeAgents),
            [
              { text: cancelLabel, style: "cancel" },
              {
                text: confirmLabel,
                style: "destructive",
                onPress: () =>
                  runUnbindDelete(conflict.activeAgents.map((a) => a.id)),
              },
            ],
          );
          return;
        }
        Alert.alert(t("runtimes.detail.deleteFailed"), failureMessage(err));
      },
    });
  }, [
    deleteRuntime,
    runtimeId,
    onDeleted,
    t,
    buildCascadeMessage,
    cancelLabel,
    confirmLabel,
    runUnbindDelete,
    failureMessage,
  ]);

  const requestDelete = useCallback(() => {
    if (!runtimeId) return;
    if (activeAgents.length > 0) {
      Alert.alert(
        t("runtimes.detail.deleteWithAgentsTitle"),
        buildCascadeMessage(activeAgents),
        [
          { text: cancelLabel, style: "cancel" },
          {
            text: confirmLabel,
            style: "destructive",
            onPress: () => runUnbindDelete(activeAgents.map((a) => a.id)),
          },
        ],
      );
      return;
    }
    Alert.alert(t("runtimes.detail.deleteConfirmTitle"), buildLightMessage(), [
      { text: cancelLabel, style: "cancel" },
      { text: confirmLabel, style: "destructive", onPress: confirmLightDelete },
    ]);
  }, [
    runtimeId,
    activeAgents,
    t,
    buildCascadeMessage,
    cancelLabel,
    confirmLabel,
    runUnbindDelete,
    buildLightMessage,
    confirmLightDelete,
  ]);

  return {
    requestDelete,
    isPending: deleteRuntime.isPending || unbindDelete.isPending,
  };
}
