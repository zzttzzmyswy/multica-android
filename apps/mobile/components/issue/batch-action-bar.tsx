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
 * ## The success claim is the SERVER's, not the selection's (iteration 272)
 *
 * Both batch endpoints skip rows they cannot act on and answer a committed
 * count (`{"updated": N}` / `{"deleted": N}` — `server/internal/handler/
 * issue.go`). This bar used to throw that count away and announce
 * `batch.updateSuccess` with `selection.length`, so a two-of-five write said
 * "已更新 5 个任务" and cleared the selection over the three rows that never
 * applied. Every settle now runs through `lib/batch-write-outcome.ts`:
 *
 *   - full commit  → success copy, selection follows `oneShot`;
 *   - short commit → `batch.updatePartial` / `batch.deletePartial` (a warning,
 *     not an error — rows DID change) and the selection is KEPT, because the
 *     skipped rows are the only handle left on the retry;
 *   - unreadable count → no count-shaped claim at all (that is `null`, not 0).
 *
 * `oneShot` mirrors web's `clearSelectionOnApply`: on for the sub-issue list
 * (a batch edit there is a one-shot dispatch, and a lingering inline bar reads
 * as unfinished), off for the full-screen lists, where the selection stays so
 * several edits can be chained.
 *
 * Success / failure feedback is a lightweight in-bar toast (mobile has no
 * toast infra; follows the "keep it local" precedent of the rest of the app).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
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
import { PickerSheet } from "@/components/issue/pickers/picker-sheet";
import { AssignConfirmDialog } from "@/components/issue/assign-confirm-dialog";
import { useBatchUpdateIssues, useBatchDeleteIssues } from "@/data/mutations/issues";
import { useIssueBatchSelectionStore } from "@/data/stores/issue-batch-selection-store";
import { agentListOptions } from "@/data/queries/agents";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { squadListOptions } from "@/data/queries/squads";
import { useWorkspaceStore } from "@/data/workspace-store";
import { commonIssueFields, needRunConfirm } from "@/lib/batch-issues";
import {
  batchSelectionAfter,
  batchToastKind,
  batchWriteOutcome,
  type BatchToastKind,
} from "@/lib/batch-write-outcome";
import {
  assignConfirmPayload,
  handoffNoteDisabled,
  handoffVerdict,
} from "@/lib/run-confirm";
import { useActorLookup } from "@/data/use-actor-name";
import { selectedActorLabel } from "@/lib/actor-name-state";
import { useTranslation } from "@/lib/i18n/react";

const TOAST_MS = 3000;

interface Props {
  /** The visible issue list this surface renders (rows the selection can
   *  intersect with — same "selectedIds ∩ visible" rule as web). */
  issues: Issue[];
  /**
   * Drop the selection once a write fully applies — web's
   * `clearSelectionOnApply`. Off for full-screen lists (the selection stays so
   * several edits can be chained); on for the sub-issue list, where a batch
   * edit is a one-shot dispatch. A partial / unreadable write keeps the
   * selection either way (`lib/batch-write-outcome.ts`).
   */
  oneShot?: boolean;
}

/** Assignee target awaiting run-confirm (agent/squad only — the sole batch
 *  action web previews in issue-run-confirm). */
type AssignConfirmTarget = {
  type: "agent" | "squad";
  id: string;
};

/** In-bar feedback toast — kind colors success / warning / error apart. */
type ToastState = {
  key: number;
  kind: BatchToastKind;
  message: string;
} | null;

export function BatchActionBar({ issues, oneShot = false }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { resolveActorName } = useActorLookup();
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

  // Handoff gate (shared with the single-issue picker route): gray the note box
  // when the target runtime is positively too old to render it. Read from the
  // warm agent / runtime / squad caches, so no round-trip — the dialog must not
  // fire a request on open (MUL-5010). `null` = cannot tell → box stays usable.
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  const { data: squads = [] } = useQuery(squadListOptions(wsId));
  const noteDisabled = handoffNoteDisabled(
    handoffVerdict({
      assigneeType: assignTarget?.type,
      assigneeId: assignTarget?.id,
      agents,
      runtimes,
      squads,
    }),
  );

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

  const showToast = useCallback((kind: BatchToastKind, message: string) => {
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

  /**
   * Settle one batch write against the count the SERVER committed. `applied`
   * is `null` when the response carried no readable count — never a stand-in
   * for zero (see `lib/batch-write-outcome.ts`).
   *
   * The partial sentence names the committed number, so a short write can
   * never render as the selection-sized sentence the old code printed.
   */
  const settleWrite = (
    requestedCount: number,
    applied: number | null,
    oneShotSurface: boolean,
    copy: {
      successKey: string;
      partialKey: string;
      /** Interpolation name the partial sentence uses for the committed count
       *  (`updated` for updates, `deleted` for deletes). */
      appliedParam: string;
    },
  ) => {
    const outcome = batchWriteOutcome(requestedCount, applied);
    if (batchSelectionAfter(outcome, oneShotSurface) === "exit") {
      useIssueBatchSelectionStore.getState().exitSelection();
    }
    showToast(
      batchToastKind(outcome),
      outcome === "partial"
        ? t(copy.partialKey, {
            [copy.appliedParam]: applied ?? 0,
            count: requestedCount,
          })
        : t(copy.successKey, { count: requestedCount }),
    );
  };

  const handleUpdate = (updates: UpdateIssueRequest) => {
    if (ids.length === 0) return;
    batchUpdate.mutate(
      { ids, updates },
      {
        onSuccess: (result) => {
          settleWrite(ids.length, result.updated, oneShot, {
            successKey: "batch.updateSuccess",
            partialKey: "batch.updatePartial",
            appliedParam: "updated",
          });
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
              // Same server-count rule as the update path. A full delete takes
              // the rows with it, so selection mode exits; a short one leaves
              // the survivors selected — they are still in the visible list,
              // so the selection is exactly the retry handle. Partial is a
              // warning, not an error: some rows really were deleted.
              onSuccess: (result) => {
                settleWrite(ids.length, result.deleted, true, {
                  successKey: "batch.deleteSuccess",
                  partialKey: "batch.deletePartial",
                  appliedParam: "deleted",
                });
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
    const updates = assignConfirmPayload(assignTarget, suppressRun, note, noteDisabled);
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
              toast.kind === "error"
                ? "bg-destructive"
                : toast.kind === "warning"
                  ? "bg-warning"
                  : "bg-foreground"
            }`}
          >
            <Text
              className={`text-body font-medium ${
                toast.kind === "error"
                  ? "text-destructive-foreground"
                  : toast.kind === "warning"
                    ? "text-foreground"
                    : "text-background"
              }`}
              numberOfLines={3}
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
            <Text className="text-body font-medium text-foreground">
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
                <Text className="text-body text-muted-foreground">
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
        // AssigneePickerBody's root is a `flex-1` FlatList, which needs a
        // definite height from the sheet (see picker-sheet.tsx).
        fill
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
        // Same echo rule as the single-issue picker: the target was chosen one
        // tap ago in this sheet, so the confirmation states it in the type's
        // own words until the directory can give a name (MYS-2227).
        name={selectedActorLabel({
          state: resolveActorName(assignTarget?.type, assignTarget?.id),
          type: assignTarget?.type,
          fallback: t("filter.assignee"),
        })}
        count={count}
        note={note}
        onNoteChange={setNote}
        busy={busy}
        noteDisabled={noteDisabled}
        onConfirm={() => applyAssign(false)}
        onDontStart={() => applyAssign(true)}
        onClose={() => {
          if (busy) return;
          setNote("");
          setAssignTarget(null);
        }}
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
