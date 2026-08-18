/**
 * Batch-action floating bar for multi-selected issues (web parity with
 * batch-action-toolbar.tsx). Floats at the bottom of the list surface that
 * opts into multi-select (my-issues / workspace issues); renders only while a
 * selection is active.
 *
 * Actions mirror web's toolbar:
 *   - Status / priority open in-place Modals hosting the shared picker bodies;
 *     each reflects the *common* value of the selection via
 *     `commonIssueFields` — mixed selections render an empty (no-checkmark)
 *     state, matching web's `BatchActionToolbar` semantics.
 *   - Assignee opens an in-place Modal hosting AssigneePickerBody with the
 *     common value checked (mixed → nothing checked) and an explicit clear
 *     option. Assigning an agent/squad routes through the run-confirm dialog
 *     (web issue-run-confirm semantics): a handoff note box plus
 *     "Confirm assignment" / "Don't start yet", suppressed entirely when every
 *     selected issue is in backlog (a parking-lot assignment can never start
 *     a run). Member / unassigned applies directly.
 *   - Delete confirms via Alert first (mobile's native confirm pattern).
 *
 * Success / failure feedback is a lightweight in-bar toast (mobile has no
 * toast infra; follows the "keep it local" precedent of the rest of the app).
 * On success the selection is cleared (`clear()`, stays in selection mode per
 * the store contract) so the user can immediately batch a next group; delete
 * exits selection mode entirely.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Issue, UpdateIssueRequest } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import {
  AssigneePickerBody,
  type AssigneeValue,
} from "@/components/issue/pickers/assignee-picker-body";
import { StatusPickerBody } from "@/components/issue/pickers/status-picker-body";
import { PriorityPickerBody } from "@/components/issue/pickers/priority-picker-body";
import { useBatchUpdateIssues, useBatchDeleteIssues } from "@/data/mutations/issues";
import { useIssueBatchSelectionStore } from "@/data/stores/issue-batch-selection-store";
import { commonIssueFields, needRunConfirm } from "@/lib/batch-issues";
import { useActorLookup } from "@/data/use-actor-name";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";

const TOAST_MS = 3000;

interface Props {
  /** The visible issue list this surface renders (rows the selection can
   *  intersect with — same "selectedIds ∩ visible" rule as web). */
  issues: Issue[];
}

/** Assignee target awaiting run-confirm (agent/squad only — the sole batch
 *  action web previews in issue-run-confirm). */
type AssignConfirmTarget = {
  type: "agent" | "squad";
  id: string;
};

/** In-bar feedback toast — kind colors success differently from error. */
type ToastState = {
  key: number;
  kind: "success" | "error";
  message: string;
} | null;

export function BatchActionBar({ issues }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { getName } = useActorLookup();
  const selectionMode = useIssueBatchSelectionStore((s) => s.selectionMode);
  const selectedIds = useIssueBatchSelectionStore((s) => s.selectedIds);
  const clear = useIssueBatchSelectionStore((s) => s.clear);
  const exitSelection = useIssueBatchSelectionStore((s) => s.exitSelection);
  const setSelected = useIssueBatchSelectionStore((s) => s.setSelected);
  const batchUpdate = useBatchUpdateIssues();
  const batchDelete = useBatchDeleteIssues();
  const [statusOpen, setStatusOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<AssignConfirmTarget | null>(
    null,
  );
  const [note, setNote] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedIssues = useMemo(
    () => issues.filter((i) => selectedIds.has(i.id)),
    [issues, selectedIds],
  );
  const count = selectedIssues.length;
  const ids = useMemo(() => selectedIssues.map((i) => i.id), [selectedIssues]);
  const busy = batchUpdate.isPending || batchDelete.isPending;

  // Reflect the real shared value in each picker; empty (no-checkmark) when
  // the selection is mixed — web commonIssueFields.
  const common = useMemo(() => commonIssueFields(selectedIssues), [selectedIssues]);

  const showToast = useCallback((kind: "success" | "error", message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ key: Date.now(), kind, message });
    toastTimer.current = setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, TOAST_MS);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // Close any open picker when the selection empties (e.g. deselected last
  // row) so no sheet floats over an empty selection.
  useEffect(() => {
    if (count > 0) return;
    setStatusOpen(false);
    setPriorityOpen(false);
    setAssigneeOpen(false);
    setAssignTarget(null);
  }, [count]);

  const handleUpdate = (updates: UpdateIssueRequest) => {
    if (ids.length === 0) return;
    batchUpdate.mutate(
      { ids, updates },
      {
        onSuccess: () => {
          clear();
          showToast("success", t("batch.updateSuccess", { count }));
        },
        onError: (err) =>
          showToast(
            "error",
            err instanceof Error && err.message
              ? err.message
              : t("batch.updateFailedBody"),
          ),
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
              onSuccess: () => {
                useIssueBatchSelectionStore.getState().exitSelection();
                showToast("success", t("batch.deleteSuccess", { count }));
              },
              onError: (err) =>
                showToast(
                  "error",
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

  const handleAssigneePick = (value: AssigneeValue) => {
    setAssigneeOpen(false);
    if (!value) {
      handleUpdate({ assignee_type: null, assignee_id: null });
      return;
    }
    if (value.type === "member") {
      handleUpdate({ assignee_type: value.type, assignee_id: value.id });
      return;
    }
    // Agent/squad assignment may start runs. Backlog never starts a run on
    // assign (parking lot), so an all-backlog selection applies directly —
    // same short-circuit as web handleBatchAssignee. Anything else goes
    // through the run-confirm dialog.
    if (!needRunConfirm(selectedIssues, value.type)) {
      handleUpdate({ assignee_type: value.type, assignee_id: value.id });
      return;
    }
    setAssignTarget({ type: value.type, id: value.id });
  };

  // Apply the confirmed assignment. `suppressRun` mirrors web's "Don't start
  // yet" button (MUL-3375 control fields pass through the same batch write).
  const applyAssign = (suppressRun: boolean) => {
    if (!assignTarget) return;
    const handoffNote = note.trim();
    const updates: UpdateIssueRequest = {
      assignee_type: assignTarget.type,
      assignee_id: assignTarget.id,
      ...(suppressRun ? { suppress_run: true } : {}),
      ...(!suppressRun && handoffNote ? { handoff_note: handoffNote } : {}),
    };
    setNote("");
    setAssignTarget(null);
    handleUpdate(updates);
  };

  // All-visible toggle (web list header's select-all checkbox). "全选" when
  // at least one visible row is unselected; "清空" when all are selected.
  const visibleIds = useMemo(() => issues.map((i) => i.id), [issues]);
  const allVisibleSelected =
    hasAtLeastOneSelected(visibleIds, selectedIds) &&
    visibleIds.every((id) => selectedIds.has(id));
  const toggleSelectAll = () => {
    if (visibleIds.length === 0) return;
    if (allVisibleSelected) clear();
    else setSelected(visibleIds);
  };

  // Render only while a selection is active (first press on a row enters
  // selection mode via the row's long-press / toggle).
  if (!selectionMode || count === 0) return null;

  return (
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
          <View className="flex-row items-center gap-2">
            {issues.length > 0 ? (
              <Pressable
                onPress={toggleSelectAll}
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
            ) : null}
            <BarButton
              label={t("batch.delete")}
              icon="trash-outline"
              onPress={handleDelete}
              busy={busy}
              destructive
            />
          </View>
        </View>
        <View className="flex-row gap-1 pt-1 pb-1">
          <BarButton
            label={t("batch.status")}
            icon="git-branch-outline"
            onPress={() => setStatusOpen(true)}
            busy={busy}
            flexible
          />
          <BarButton
            label={t("batch.priority")}
            icon="flag-outline"
            onPress={() => setPriorityOpen(true)}
            busy={busy}
            flexible
          />
          <BarButton
            label={t("batch.assignee")}
            icon="person-outline"
            onPress={() => setAssigneeOpen(true)}
            busy={busy}
            flexible
          />
        </View>
      </View>
      <PickerSheet
        title={t("picker.status")}
        visible={statusOpen}
        onClose={() => setStatusOpen(false)}
      >
        <StatusPickerBody value={common.status} onChange={(s) => {
          setStatusOpen(false);
          handleUpdate({ status: s });
        }} />
      </PickerSheet>
      <PickerSheet
        title={t("picker.priority")}
        visible={priorityOpen}
        onClose={() => setPriorityOpen(false)}
      >
        <PriorityPickerBody value={common.priority} onChange={(p) => {
          setPriorityOpen(false);
          handleUpdate({ priority: p });
        }} />
      </PickerSheet>
      <PickerSheet
        title={t("batch.pickAssigneeTitle")}
        visible={assigneeOpen}
        onClose={() => setAssigneeOpen(false)}
      >
        <AssigneePickerBody
          value={
            common.assignee?.type
              ? { type: common.assignee.type, id: common.assignee.id! }
              : null
          }
          mixed={common.assignee === null}
          query=""
          onChange={handleAssigneePick}
        />
      </PickerSheet>
      <AssignConfirmDialog
        visible={assignTarget !== null}
        name={getName(assignTarget?.type, assignTarget?.id)}
        count={count}
        note={note}
        onNoteChange={setNote}
        busy={busy}
        onConfirm={() => applyAssign(false)}
        onDontStart={() => applyAssign(true)}
        onClose={() => {
          if (busy) return;
          setNote("");
          setAssignTarget(null);
        }}
        t={t}
      />
    </View>
  );
}

function hasAtLeastOneSelected(
  visibleIds: string[],
  selectedIds: Set<string>,
): boolean {
  for (const id of visibleIds) {
    if (selectedIds.has(id)) return true;
  }
  return false;
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
      variant="ghost"
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

/** Bottom-sheet host for the shared picker bodies. */
function PickerSheet({
  title,
  visible,
  onClose,
  children,
}: {
  title: string;
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
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
                {title}
              </Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={20} color="currentColor" />
              </Pressable>
            </View>
            {/* Picker bodies render their own scrolling container
                (Status/Priority: ScrollView, Assignee: FlatList) — no
                nested scroll here. */}
            <View className="max-h-[60%]">{children}</View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

/**
 * Run-confirm for batch agent/squad assignment (web issue-run-confirm
 * semantics, MUL-5010): the dialog confirms the ASSIGNMENT — completion is
 * silent, whether a run starts stays the server's write-time decision. A
 * handoff note rides along on the "Confirm assignment" path; "Don't start
 * yet" suppresses the run (suppress_run).
 */
function AssignConfirmDialog({
  visible,
  name,
  count,
  note,
  onNoteChange,
  busy,
  onConfirm,
  onDontStart,
  onClose,
  t,
}: {
  visible: boolean;
  name: string;
  count: number;
  note: string;
  onNoteChange: (note: string) => void;
  busy: boolean;
  onConfirm: () => void;
  onDontStart: () => void;
  onClose: () => void;
  t: (id: string, params?: Record<string, string | number>) => string;
}) {
  const { colorScheme } = useColorScheme();
  const headline =
    count > 1
      ? t("batch.confirmAssignBatch", { count, name })
      : t("batch.confirmAssignOne", { name });
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 justify-center px-6">
          <Pressable onPress={() => {}} className="bg-popover rounded-2xl p-4">
            <Text className="text-base font-semibold text-foreground">
              {t("batch.confirmAssignTitle")}
            </Text>
            <Text className="text-sm text-muted-foreground leading-5 mt-1.5">
              {headline}
            </Text>
            <View className="mt-3">
              <Text className="text-xs font-medium text-foreground">
                {t("batch.handoffNote")}
              </Text>
              <TextInput
                value={note}
                onChangeText={onNoteChange}
                placeholder={t("batch.handoffPlaceholder")}
                placeholderTextColor={THEME[colorScheme].mutedForeground}
                multiline
                className="border border-border rounded-lg px-3 py-2 mt-1.5 text-sm text-foreground min-h-[72px]"
              />
            </View>
            <View className="flex-row gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={busy}
                onPress={onDontStart}
              >
                <Text>{t("batch.dontStart")}</Text>
              </Button>
              <Button
                size="sm"
                className="flex-1"
                disabled={busy}
                onPress={onConfirm}
              >
                <Text>{t("batch.confirmAssign")}</Text>
              </Button>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}