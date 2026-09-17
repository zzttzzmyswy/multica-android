/**
 * Batch-action bar for the workspace skills list (MYS-1156, web parity with
 * `packages/views/skills/components/skill-list-actions.tsx`).
 *
 * Web's `SkillBatchToolbar` is a floating bar at the bottom of the page with
 * "Add to agent" and "Delete"; both open dialogs that the single-row kebab
 * shares. Mobile renders the same two actions with the same permission rule
 * (`canEditSkill` per row — Delete is disabled unless EVERY selected row is
 * editable, web's `allDeletable`), shaped like the issues batch bar so the two
 * multi-select surfaces in this app behave alike.
 *
 * Differences that come from the platform, not from a change of intent:
 *   - The confirm is `Alert.alert` (the app's native confirm pattern) rather
 *     than a rendered dialog.
 *   - Results come back as an all-settled outcome, so a partial failure is
 *     reported as "N deleted, M failed: <first error>" instead of web's
 *     all-or-nothing toast.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Agent, SkillSummary } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { MultiSelectSheet } from "@/components/agent/multi-select-sheet";
import { agentListOptions } from "@/data/queries/agents";
import {
  useBatchAddSkillsToAgents,
  useBatchDeleteSkills,
} from "@/data/mutations/skills";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { canEditSkill } from "@/lib/skill-guards";
import { useSkillRole } from "@/lib/use-skill-role";
import {
  batchOutcomeMessage,
  missingSkillIds,
  planSkillAttach,
  toggleId,
} from "@/lib/skill-batch";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";

const TOAST_MS = 4000;

interface Props {
  /** The selected rows, already intersected with what the list shows now. */
  selectedSkills: SkillSummary[];
  /** Every id the list currently renders — the scope of select-all. */
  visibleIds: readonly string[];
  onToggleSelectAll: () => void;
  /** Leave selection mode (the bar's "Done"). */
  onExit: () => void;
  /** Drop the selection but stay in selection mode (after a batch write). */
  onClear: () => void;
}

interface Toast {
  key: number;
  kind: "success" | "error";
  message: string;
}

export function SkillBatchBar({
  selectedSkills,
  visibleIds,
  onToggleSelectAll,
  onExit,
  onClear,
}: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id);
  const role = useSkillRole(wsId);
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const batchDelete = useBatchDeleteSkills();
  const batchAttach = useBatchAddSkillsToAgents();

  const [addOpen, setAddOpen] = useState(false);
  const [agentSelection, setAgentSelection] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((kind: Toast["kind"], message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ key: Date.now(), kind, message });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const skillIds = useMemo(
    () => selectedSkills.map((s) => s.id),
    [selectedSkills],
  );
  const selectedIdSet = useMemo(() => new Set(skillIds), [skillIds]);
  const count = skillIds.length;
  const busy = batchDelete.isPending || batchAttach.isPending;
  const allDeletable = selectedSkills.every((skill) =>
    canEditSkill(skill, { userId, role }),
  );
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIdSet.has(id));

  /**
   * "My agents" / "Other agents" buckets, minus the targets that already hold
   * every selected skill (nothing to send — the attach endpoint is additive,
   * so those rows are a no-op rather than an error). A partial overlap stays
   * selectable and says how much of the selection is already there.
   */
  const agentGroups = useMemo(() => {
    const active = agents.filter((a) => !a.archived_at);
    const isAdmin = role === "owner" || role === "admin";
    const mine = active.filter(
      (a) => a.owner_id !== null && a.owner_id === userId,
    );
    const others = isAdmin
      ? active.filter((a) => a.owner_id === null || a.owner_id !== userId)
      : [];
    const toRow = (agent: Agent) => {
      const owned = count - missingSkillIds(agent, skillIds).length;
      return {
        key: agent.id,
        title: agent.name,
        subtitle: owned > 0 ? t("skills.batch.partial", { owned, total: count }) : undefined,
      };
    };
    return [
      {
        label: t("skills.usedBy.mine"),
        rows: mine
          .filter((a) => missingSkillIds(a, skillIds).length > 0)
          .map(toRow),
      },
      {
        label: t("skills.usedBy.others"),
        rows: others
          .filter((a) => missingSkillIds(a, skillIds).length > 0)
          .map(toRow),
      },
    ];
  }, [agents, role, userId, skillIds, count, t]);

  const handleAddToAgents = () => {
    const plan = planSkillAttach(agents, [...agentSelection], skillIds);
    setAddOpen(false);
    setAgentSelection(new Set());
    if (plan.length === 0) return;
    batchAttach.mutate(plan, {
      onSuccess: (outcome) => {
        const message = batchOutcomeMessage(outcome, {
          success: (done) =>
            done === 1
              ? t("skills.batch.addedOne")
              : t("skills.batch.addedCount", { count: done }),
          failure: (done, failed, first) =>
            t("skills.batch.addPartial", { done, failed, message: first }),
        });
        showToast(
          outcome.failures.length === 0 ? "success" : "error",
          message ?? t("skills.usedBy.addFailed"),
        );
      },
      onError: (err) =>
        showToast(
          "error",
          err instanceof Error && err.message
            ? err.message
            : t("skills.usedBy.addFailed"),
        ),
    });
  };

  const runDelete = () => {
    batchDelete.mutate(skillIds, {
      onSuccess: (outcome) => {
        const message = batchOutcomeMessage(outcome, {
          success: (done) => t("skills.batch.deleteSuccess", { count: done }),
          failure: (done, failed, first) =>
            t("skills.batch.deletePartial", { done, failed, message: first }),
        });
        showToast(
          outcome.failures.length === 0 ? "success" : "error",
          message ?? t("skills.batch.deleteFailed"),
        );
        onClear();
      },
      onError: (err) =>
        showToast(
          "error",
          err instanceof Error && err.message
            ? err.message
            : t("skills.batch.deleteFailed"),
        ),
    });
  };

  const handleDelete = () => {
    // One selected row reads as the single-skill confirmation (web's
    // DeleteSkillsDialog branches on rows.length === 1 for exactly this
    // reason: "Delete skill?" with the name beats "Delete 1 skills?").
    const single = count === 1 ? selectedSkills[0] : null;
    Alert.alert(
      single
        ? t("skills.deleteTitle")
        : t("skills.batch.deleteTitle", { count }),
      single
        ? t("skills.deleteMessage", { name: single.name })
        : t("skills.batch.deleteMessage", { count }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("batch.delete"), style: "destructive", onPress: runDelete },
      ],
    );
  };

  if (count === 0) return null;

  return (
    <>
      <View
        className="absolute inset-x-0 bg-background border-t border-border"
        style={{ bottom: insets.bottom, paddingBottom: insets.bottom }}
      >
        {toast ? (
          <View
            key={toast.key}
            className="absolute inset-x-0 -top-12 px-4"
            pointerEvents="none"
          >
            <View
              className={`mx-auto rounded-lg px-4 py-2 shadow-lg ${
                toast.kind === "error" ? "bg-destructive" : "bg-foreground"
              }`}
            >
              <Text
                className={`text-sm font-medium ${
                  toast.kind === "error"
                    ? "text-destructive-foreground"
                    : "text-background"
                }`}
                numberOfLines={2}
              >
                {toast.message}
              </Text>
            </View>
          </View>
        ) : null}
        <View className="px-4 py-2">
          <View className="flex-row items-center justify-between">
            <Pressable
              onPress={onExit}
              className="flex-row items-center gap-1.5 py-1"
              accessibilityLabel={t("batch.exit")}
            >
              <Ionicons name="close" size={18} color="currentColor" />
              <Text className="text-sm font-medium text-foreground">
                {t("batch.selected", { count })}
              </Text>
            </Pressable>
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={onToggleSelectAll}
                className="flex-row items-center gap-1 py-1 px-1"
                accessibilityLabel={
                  allVisibleSelected
                    ? t("batch.clearSelection")
                    : t("batch.selectAll")
                }
              >
                <Ionicons
                  name={
                    allVisibleSelected
                      ? "checkmark-done-outline"
                      : "checkbox-outline"
                  }
                  size={16}
                  color="currentColor"
                />
                <Text className="text-sm text-muted-foreground">
                  {allVisibleSelected
                    ? t("batch.clearSelection")
                    : t("batch.selectAll")}
                </Text>
              </Pressable>
              <Button
                variant="ghost"
                size="sm"
                onPress={handleDelete}
                disabled={!allDeletable || busy}
                accessibilityLabel={
                  allDeletable
                    ? t("batch.delete")
                    : t("skills.batch.deleteNoPermission")
                }
              >
                <Ionicons
                  name="trash-outline"
                  size={16}
                  color={allDeletable ? "#dc2626" : theme.mutedForeground}
                />
                <Text
                  className={
                    allDeletable ? "text-destructive" : "text-muted-foreground"
                  }
                >
                  {t("batch.delete")}
                </Text>
              </Button>
            </View>
          </View>
          {!allDeletable ? (
            <Text className="text-[11px] text-muted-foreground pt-0.5">
              {t("skills.batch.deleteNoPermission")}
            </Text>
          ) : null}
          <View className="flex-row gap-1 pt-1 pb-1">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 justify-center"
              onPress={() => setAddOpen(true)}
              disabled={busy}
            >
              <Ionicons name="add-circle-outline" size={16} />
              <Text numberOfLines={1}>{t("skills.usedBy.add")}</Text>
            </Button>
          </View>
        </View>
      </View>

      <MultiSelectSheet
        visible={addOpen}
        title={t("skills.usedBy.addTitle")}
        groups={agentGroups}
        searchPlaceholder={t("skills.usedBy.searchPlaceholder")}
        selectedKeys={agentSelection}
        emptyText={t("skills.usedBy.noAgents")}
        noMatchText={t("skills.usedBy.noMatch")}
        leading={(row) => <ActorAvatar type="agent" id={row.key} size={28} />}
        onToggle={(key) => setAgentSelection(toggleId(agentSelection, key))}
        onClose={handleAddToAgents}
      />
    </>
  );
}

/**
 * Results come back from the mutation already aggregated, so each write
 * reports one line: the success count, or "N done, M failed: <first error>".
 */