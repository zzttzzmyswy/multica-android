/**
 * Batch-action floating bar for multi-selected issues (web parity with
 * batch-action-toolbar.tsx). Floats at the bottom of the list surface that
 * opts into multi-select (my-issues today); renders only while a selection is
 * active.
 *
 * Actions mirror web's toolbar: status / priority / assignee batch-update and
 * batch delete. Status + priority flow through the cross-platform ActionSheet
 * (text options); assignee opens an in-place Modal hosting AssigneePickerBody
 * (with an explicit "clear" option); delete confirms via Alert first.
 *
 * On success the selection is cleared (`clear()`, stays in selection mode per
 * the store contract) so the user can immediately batch a next group.
 */
import { useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import type {
  Issue,
  IssueStatus,
  UpdateIssueRequest,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import {
  AssigneePickerBody,
  type AssigneeValue,
} from "@/components/issue/pickers/assignee-picker-body";
import { useBatchUpdateIssues, useBatchDeleteIssues } from "@/data/mutations/issues";
import { useIssueBatchSelectionStore } from "@/data/stores/issue-batch-selection-store";
import { ActionSheet } from "@/lib/action-sheet";
import { BOARD_STATUSES } from "@/lib/issue-status";
import { useTranslation } from "@/lib/i18n/react";

const ALL_STATUSES: IssueStatus[] = [...BOARD_STATUSES, "cancelled"];
const PRIORITY_ORDER: Issue["priority"][] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

interface Props {
  /** The visible issue list this surface renders (rows the selection can
   *  intersect with — same "selectedIds ∩ visible" rule as web). */
  issues: Issue[];
}

export function BatchActionBar({ issues }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const selectionMode = useIssueBatchSelectionStore((s) => s.selectionMode);
  const selectedIds = useIssueBatchSelectionStore((s) => s.selectedIds);
  const clear = useIssueBatchSelectionStore((s) => s.clear);
  const exitSelection = useIssueBatchSelectionStore((s) => s.exitSelection);
  const batchUpdate = useBatchUpdateIssues();
  const batchDelete = useBatchDeleteIssues();
  const [assigneeOpen, setAssigneeOpen] = useState(false);

  const selectedIssues = useMemo(
    () => issues.filter((i) => selectedIds.has(i.id)),
    [issues, selectedIds],
  );
  const count = selectedIssues.length;
  const ids = useMemo(() => selectedIssues.map((i) => i.id), [selectedIssues]);
  const busy = batchUpdate.isPending || batchDelete.isPending;

  const handleUpdate = (updates: UpdateIssueRequest) => {
    if (ids.length === 0) return;
    batchUpdate.mutate(
      { ids, updates },
      {
        onSuccess: () => clear(),
        onError: (err) =>
          Alert.alert(
            t("batch.updateFailedTitle"),
            err instanceof Error && err.message
              ? err.message
              : t("batch.updateFailedBody"),
          ),
      },
    );
  };

  const handleStatus = () => {
    ActionSheet.showActionSheetWithOptions(
      {
        options: [
          t("issue.cancel"),
          ...ALL_STATUSES.map((s) => t(`enum.status.${s}`)),
        ],
        cancelButtonIndex: 0,
      },
      (i) => {
        const status = ALL_STATUSES[i - 1];
        if (status) handleUpdate({ status });
      },
    );
  };

  const handlePriority = () => {
    ActionSheet.showActionSheetWithOptions(
      {
        options: [
          t("issue.cancel"),
          ...PRIORITY_ORDER.map((p) => t(`enum.priority.${p}`)),
        ],
        cancelButtonIndex: 0,
      },
      (i) => {
        const priority = PRIORITY_ORDER[i - 1];
        if (priority) handleUpdate({ priority });
      },
    );
  };

  const handleAssignee = () => {
    ActionSheet.showActionSheetWithOptions(
      {
        options: [
          t("issue.cancel"),
          t("batch.pickAssignee"),
          t("batch.clearAssignee"),
        ],
        cancelButtonIndex: 0,
        destructiveButtonIndex: 2,
      },
      (i) => {
        if (i === 1) setAssigneeOpen(true);
        else if (i === 2) handleUpdate({ assignee_type: null, assignee_id: null });
      },
    );
  };

  const handleDelete = () => {
    Alert.alert(
      t("batch.deleteTitle", { count }),
      t("batch.deleteMessage", { count }),
      [
        { text: t("issue.cancel"), style: "cancel" },
        {
          text: t("issue.delete"),
          style: "destructive",
          onPress: () => {
            batchDelete.mutate(ids, {
              onSuccess: () =>
                useIssueBatchSelectionStore.getState().exitSelection(),
              onError: (err) =>
                Alert.alert(
                  t("batch.deleteFailedTitle"),
                  err instanceof Error && err.message
                    ? err.message
                    : t("batch.deleteFailedBody"),
                ),
            });
          },
        },
      ],
    );
  };

  // Render only while a selection is active (first press on a row enters
  // selection mode via the row's long-press / toggle).
  if (!selectionMode || count === 0) return null;

  return (
    <View
      className="absolute inset-x-0 bg-background border-t border-border"
      style={{ bottom: insets.bottom, paddingBottom: insets.bottom }}
    >
      <View className="px-4 pt-2">
        <View className="flex-row items-center justify-between">
          <Pressable
            onPress={exitSelection}
            className="flex-row items-center gap-1.5 py-1"
            accessibilityLabel={t("batch.exit")}
          >
            <Ionicons name="close" size={18} color="currentColor" />
            <Text className="text-sm font-medium text-foreground">
              {t("batch.selected", { count })}
            </Text>
          </Pressable>
          <BarButton
            label={t("batch.delete")}
            icon="trash-outline"
            onPress={handleDelete}
            busy={busy}
            destructive
          />
        </View>
        <View className="flex-row gap-1 pt-1 pb-1">
          <BarButton
            label={t("batch.status")}
            icon="git-branch-outline"
            onPress={handleStatus}
            busy={busy}
            flexible
          />
          <BarButton
            label={t("batch.priority")}
            icon="flag-outline"
            onPress={handlePriority}
            busy={busy}
            flexible
          />
          <BarButton
            label={t("batch.assignee")}
            icon="person-outline"
            onPress={handleAssignee}
            busy={busy}
            flexible
          />
        </View>
      </View>
      <AssigneeSheet
        visible={assigneeOpen}
        onClose={() => setAssigneeOpen(false)}
        onPick={(value) => {
          setAssigneeOpen(false);
          handleUpdate(
            value
              ? { assignee_type: value.type, assignee_id: value.id }
              : { assignee_type: null, assignee_id: null },
          );
        }}
      />
    </View>
  );
}

function BarButton({
  label,
  icon,
  onPress,
  busy,
  destructive,
  flexible,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  busy: boolean;
  destructive?: boolean;
  flexible?: boolean;
}) {
  return (
    <Button
      variant={destructive ? "ghost" : "ghost"}
      size="sm"
      onPress={onPress}
      disabled={busy}
      className={flexible ? "flex-1 justify-center" : undefined}
    >
      <Ionicons
        name={icon}
        size={16}
        color={destructive ? "#dc2626" : undefined}
      />
      <Text
        className={destructive ? "text-destructive" : "text-foreground"}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Button>
  );
}

/** Bottom-sheet host for the shared assignee picker body. */
function AssigneeSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (value: AssigneeValue) => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 justify-end">
          <Pressable onPress={() => {}} className="bg-popover rounded-t-2xl max-h-[70%]">
            <View className="px-4 py-3 border-b border-border flex-row items-center justify-between">
              <Text className="text-base font-semibold text-foreground">
                {t("batch.pickAssigneeTitle")}
              </Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={20} color="currentColor" />
              </Pressable>
            </View>
            <View className="max-h-[60%]">
              <ScrollView>
                <AssigneePickerBody
                  value={null}
                  query=""
                  onChange={onPick}
                />
              </ScrollView>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}