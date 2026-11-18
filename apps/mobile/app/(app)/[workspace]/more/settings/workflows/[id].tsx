/**
 * The workflow editor (iteration 294) — mobile's port of web's
 * `WorkflowEditorPage` (`packages/views/workflows/workflow-editor-page.tsx`,
 * MUL-7420).
 *
 * ## What this screen is for
 *
 * Before this round the phone could change 「某一列交给谁」 and nothing else. A
 * pipeline could be built, renamed, re-columned and deleted only on the
 * desktop. Every decision this editor makes is in `lib/workflow-editor.ts`
 * (pure, tested); this file is the layout, and the four things below are the
 * layout's own obligations.
 *
 * ## 1. The save goes through a DRY RUN when it drops a status
 *
 * The server refuses an edit that removes a status whose issues have nowhere to
 * go, with `409 workflow_status_mapping_required` and a plan naming each one.
 * Meeting that refusal cold is the defect `lib/workflow-editor.ts:saveNeedsDryRun`
 * exists to prevent, so the save first asks `dryRunIssueWorkflowUpdate`, and a
 * plan with rows opens the same mapping dialog a project switch uses. Only a
 * plan with no rows proceeds straight to the write.
 *
 * ## 2. A created status only an admin may add BLOCKS the save, with names
 *
 * Statuses are shared by every board. A member may rebuild a pipeline out of
 * the existing library but may not add to the catalog; the server answers 403
 * `status_create_forbidden`. Rather than let them reach that, the screen lists
 * the statuses in the way (`missingStatusNames`) and says who can add them.
 *
 * ## 3. The pinned columns cannot be moved, removed or reordered
 *
 * Todo, Done and Cancelled are always there; Backlog and Blocked are switches.
 * The server arranges them (`issueworkflow.Arrange`) — so a phone that let
 * someone drag `done` between two middle columns would show one order before
 * the save and another after the refresh. Reordering is up/down on the MIDDLE
 * only, which is also how every other orderable list in this app works
 * (`more/settings/issue-statuses.tsx`).
 *
 * ## 4. A failed save must not look like a saved one
 *
 * `mutateAsync`, and the screen closes only once the server has accepted. A
 * 403 is an EXPECTED answer here (owner-or-admin only), so closing first would
 * make a refused save indistinguishable from a successful one.
 *
 * ## What must differ from web
 *
 *   - **One scrolling column, not a two-pane grid.** Web puts the column list
 *     and the selected step's detail side by side on a 1024px canvas. A phone
 *     stacks them: the list, then the selected column's handoff fields
 *     underneath it, in one scroll. Same contents, same order of decisions.
 *   - **The step detail is inline, not a popover.** Selecting a column reveals
 *     its fields below the list rather than in a sheet: the fields are long
 *     (handler picker, instructions, next/back) and a sheet would hide the
 *     column list the user is editing against.
 *   - **No templates.** Web's 「从模板新建」 menu (`templates.ts`) is not
 *     ported: three of its five statuses per template are NEW statuses, which
 *     only admins may create, so on a phone the menu would be a shortcut to the
 *     admin-only block for most members. 「空白工作流」 is what the new screen
 *     opens with, pre-filled with the common delivery loop — the same middle
 *     columns web's blank draft starts from.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { IssueWorkflowMappingPlan } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { StatusIcon } from "@/components/ui/status-icon";
import { Switch } from "@/components/ui/switch";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { HeaderSearchGroup } from "@/components/ui/header-search-button";
import { HandoffFields } from "@/components/workflow/handoff-fields";
import { WorkflowMappingDialog } from "@/components/project/workflow-mapping-dialog";
import { useIssueWorkflows } from "@/data/queries/workflows";
import { projectListOptions } from "@/data/queries/projects";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import {
  useCreateIssueWorkflow,
  useDeleteIssueWorkflow,
  useUpdateIssueWorkflow,
} from "@/data/mutations/workflow-editor";
import { useWorkflowManagePermissions } from "@/data/use-workflow-manage-permissions";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { api } from "@/data/api";
import { useStatusLabel } from "@/lib/status-options";
import { handoffModeOf } from "@/lib/workflow-handoff-edit";
import { statusAcceptsHandoff, workflowNextStatus } from "@/lib/workflow";
import {
  WORKFLOW_DESCRIPTION_MAX,
  WORKFLOW_NAME_MAX,
  addNewStatusColumn,
  addStatusColumn,
  addableStatusKeys,
  boardColumns,
  buildWriteRequest,
  canSaveDraft,
  deleteBlocked,
  draftFlow,
  draftFrom,
  draftHandoff,
  isDraftDirty,
  isPinnedStatus,
  listedStatusKeys,
  missingStatusNames,
  moveColumn,
  newWorkflowDraft,
  patchHandoff,
  removeColumn,
  saveNeedsDryRun,
  showsUnsavedNote,
  toggleOptionalColumn,
  usageProjectIds,
  type DraftColumn,
  type WorkflowDraft,
} from "@/lib/workflow-editor";
import { useTranslation } from "@/lib/i18n/react";
import { cn } from "@/lib/utils";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";

export default function WorkflowEditorScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ workspace: string; id: string }>();
  const wsSlug = params.workspace;
  const isNew = params.id === "new";

  const { workflows } = useIssueWorkflows(useWorkspaceStore((s) => s.currentWorkspaceId));
  const saved = isNew ? null : (workflows?.find((w) => w.id === params.id) ?? null);

  return (
    <>
      <Stack.Screen
        options={{
          title: isNew
            ? t("workflow.editor.createTitle")
            : (saved?.name ?? t("workflow.settings.titleFallback")),
        }}
      />
      <WorkflowEditor
        key={isNew ? "new" : (saved?.id ?? "pending")}
        wsSlug={wsSlug}
        saved={saved}
        isNew={isNew}
        loaded={workflows !== undefined}
      />
    </>
  );
}

function WorkflowEditor({
  wsSlug,
  saved,
  isNew,
  loaded,
}: {
  wsSlug: string | undefined;
  saved: Awaited<ReturnType<typeof useIssueWorkflows>>["workflows"] extends
    | (infer W)[]
    | undefined
    ? W | null
    : never;
  isNew: boolean;
  loaded: boolean;
}) {
  const { t } = useTranslation();
  const theme = useThemePalette();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const permissions = useWorkflowManagePermissions();
  const create = useCreateIssueWorkflow();
  const update = useUpdateIssueWorkflow();
  const remove = useDeleteIssueWorkflow();
  const { data: projects } = useQuery(projectListOptions(wsId));
  const { activeStatuses, categoryOf } = useIssueStatuses(wsId);
  const statusLabel = useStatusLabel(wsId);

  const isDefault = !!saved?.is_default;
  const canEdit = isNew ? permissions.canCreate : permissions.canEdit(saved);

  const baseline = useMemo<WorkflowDraft>(
    () => (saved ? draftFrom(saved) : newWorkflowDraft()),
    // The saved row is re-read from the cache; `updated_at` is what moves when
    // someone else edits it, so a stale draft is re-seeded exactly then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saved?.id, saved?.updated_at],
  );

  const [draft, setDraft] = useState<WorkflowDraft>(baseline);
  const [selected, setSelected] = useState<string>("todo");
  const [newStatusName, setNewStatusName] = useState<string | null>(null);
  const [mappingPlan, setMappingPlan] = useState<IssueWorkflowMappingPlan | null>(null);
  const [saving, setSaving] = useState(false);
  const [addingOpen, setAddingOpen] = useState(false);

  useEffect(() => setDraft(baseline), [baseline]);

  const dirty = isDraftDirty(isNew ? null : (saved?.id ?? null), draft, baseline);
  const pending = saving || create.isPending || update.isPending;
  const missing = missingStatusNames(draft, permissions.canCreateStatus);
  const canSave = canEdit && canSaveDraft({
    canEdit,
    dirty,
    name: draft.name,
    pending,
    missingStatuses: missing,
  });

  const columns = boardColumns(draft);
  const catalogKeys = activeStatuses.map((e) => e.key);
  const addable = addableStatusKeys(catalogKeys, draft);
  const targetKeys = listedStatusKeys(draft);

  const selectedId = columns.some((c) => c.id === selected) ? selected : "todo";
  const selectedColumn = columns.find((c) => c.id === selectedId)!;
  const selectedDraftColumn = draft.middle.find((c) => c.id === selectedId);
  const selectedOff =
    (selectedColumn.status_key === "backlog" && !draft.backlog) ||
    (selectedColumn.status_key === "blocked" && !draft.blocked);

  const defaultNextKey = workflowNextStatus(draftFlow(draft), selectedColumn.status_key);
  const defaultNextLabel = defaultNextKey ? statusLabel(defaultNextKey) : "";

  /**
   * Writes the draft, closing only once the server accepted.
   *
   * `mutateAsync` rather than `mutate`: a 403 is an EXPECTED answer here
   * (owner-or-admin only), so closing first would make a refused save
   * indistinguishable from a saved one.
   */
  const save = useCallback(
    async (mapping?: Record<string, string>) => {
      if (!canSave && !mapping) return;
      const body = buildWriteRequest({ draft, isDefault, statusMapping: mapping });
      setSaving(true);
      try {
        if (isNew) {
          const created = await create.mutateAsync(body);
          // A drifted body parses to an EMPTY row (id ""). Navigating on that
          // would land on a not-found screen for a workflow that WAS created.
          if (created.id && wsSlug) {
            router.replace(`/${wsSlug}/more/settings/workflows/${created.id}`);
          } else {
            router.back();
          }
          return;
        }
        if (!saved) return;
        await update.mutateAsync({ id: saved.id, ...body });
        setMappingPlan(null);
        router.back();
      } catch {
        // Reported by the shared write-failure channel
        // (`data/mutations/workflow-editor.ts`). The screen stays open with the
        // draft intact so the user can correct or retry.
      } finally {
        setSaving(false);
      }
    },
    [canSave, create, draft, isDefault, isNew, saved, update, wsSlug],
  );

  /**
   * The save button's actual decision: dry run first when the edit drops a
   * status, straight to the write otherwise.
   *
   * The dry run is asked EVERY time it applies rather than remembered, because
   * the plan depends on which issues are on which statuses right now — the
   * whole reason the project switch does the same (`dryRunProjectWorkflow`).
   */
  const onSavePressed = useCallback(async () => {
    if (!saved || !saveNeedsDryRun({ saved, draft })) {
      await save();
      return;
    }
    const body = buildWriteRequest({ draft, isDefault });
    setSaving(true);
    try {
      const preview = await api.dryRunIssueWorkflowUpdate(saved.id, body);
      if (preview.plan.required.length > 0) {
        setMappingPlan(preview.plan);
        return;
      }
      // Nothing to move: the plan disagrees with the local "needs a dry run"
      // guess (no issues sit on the dropped statuses), so write straight away
      // rather than opening a dialog with no rows to answer.
      await save();
    } catch {
      // A failed dry run must not block the save: the write either succeeds or
      // the server refuses with the real plan, which is strictly better
      // information than anything a preview failure carries.
      await save();
    } finally {
      setSaving(false);
    }
  }, [draft, isDefault, save, saved]);

  const onDelete = useCallback(() => {
    if (!saved) return;
    Alert.alert(
      t("workflow.settings.deleteTitle", { name: saved.name }),
      t("workflow.settings.deleteMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("workflow.settings.delete"),
          style: "destructive",
          onPress: async () => {
            try {
              await remove.mutateAsync(saved.id);
              router.back();
            } catch {
              // Reported by the shared channel with this write's own title.
            }
          },
        },
      ],
    );
  }, [remove, saved, t]);

  if (!isNew && !loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (!isNew && loaded && !saved) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-background px-6">
        <Ionicons name="git-branch-outline" size={28} color={theme.mutedForeground} />
        <Text className="text-body text-foreground">{t("workflow.editor.notFound")}</Text>
        <Text className="text-caption text-muted-foreground text-center">
          {t("workflow.editor.notFoundHint")}
        </Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          className="mt-2 rounded-md border border-border px-3 py-2 active:bg-secondary"
        >
          <Text className="text-body text-foreground">{t("common.back")}</Text>
        </Pressable>
      </View>
    );
  }

  const blocked = deleteBlocked({ workflow: saved });
  const usedBy = saved ? usageProjectIds(saved, projects) : [];

  return (
    <>
      {/* The header holds this screen's one commit control. It composes the
          shared search entry beside it because declaring a `headerRight` at all
          REPLACES the navigator's default wholesale (React Navigation merges
          options key-by-key) — the same reason `more/labels.tsx` and
          `more/squads.tsx` compose `HeaderSearchGroup`. A reader
          (`canEdit === false`) declares NO `headerRight`: omitting the key
          leaves the default entry in place, where a null-returning one would
          erase it. */}
      <Stack.Screen
        options={
          canEdit
            ? {
                headerRight: () => (
                  <HeaderSearchGroup>
                    <Pressable
                      onPress={() => void onSavePressed()}
                      disabled={!canSave}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !canSave }}
                      hitSlop={8}
                      className="px-2 active:opacity-60"
                    >
                      <Text
                        className={cn(
                          "text-body font-semibold",
                          canSave ? "text-brand" : "text-muted-foreground/50",
                        )}
                      >
                        {isNew ? t("workflow.editor.create") : t("workflow.editor.save")}
                      </Text>
                    </Pressable>
                  </HeaderSearchGroup>
                ),
              }
            : {}
        }
      />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="px-4 py-4 gap-4 pb-16"
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Name and description, editable in place like web's inline fields */}
        <View className="gap-2">
          <Text className="text-caption font-medium text-muted-foreground">
            {t("workflow.editor.name")}
          </Text>
          <TextField
            value={draft.name}
            onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
            editable={canEdit && !isDefault}
            maxLength={WORKFLOW_NAME_MAX}
            placeholder={t("workflow.editor.namePlaceholder")}
          />
          <Text className="text-caption font-medium text-muted-foreground pt-1">
            {t("workflow.editor.description")}
          </Text>
          <TextField
            value={draft.description}
            onChangeText={(description) => setDraft((d) => ({ ...d, description }))}
            editable={canEdit}
            maxLength={WORKFLOW_DESCRIPTION_MAX}
            placeholder={t("workflow.editor.descriptionPlaceholder")}
          />
          <Text className="text-caption text-muted-foreground">
            {isDefault
              ? t("workflow.editor.defaultNote")
              : usedBy.length > 0
                ? t("workflow.editor.usedByNote", {
                    count: usedBy.length,
                    names: (projects ?? [])
                      .filter((p) => usedBy.includes(p.id))
                      .map((p) => p.title)
                      .join(t("workflow.listSeparator")),
                  })
                : t("workflow.editor.unusedNote")}
          </Text>
          {showsUnsavedNote({ isNew, dirty, canEdit }) ? (
            <Text className="text-caption text-warning">{t("workflow.editor.unsaved")}</Text>
          ) : null}
          {!canEdit && permissions.roleResolved ? (
            <Text className="text-caption text-muted-foreground">
              {t("workflow.editor.readOnly")}
            </Text>
          ) : null}
        </View>

        {/* ── The columns, in board order ─────────────────────────────── */}
        <View className="gap-2">
          <Text className="text-caption font-medium text-muted-foreground">
            {t("workflow.editor.columns")}
          </Text>
          <View className="rounded-lg border border-border bg-card overflow-hidden">
            {columns.map((column, index) => {
              const draftColumn = draft.middle.find((c) => c.id === column.id);
              const pinned = isPinnedStatus(column.status_key);
              const off =
                (column.status_key === "backlog" && !draft.backlog) ||
                (column.status_key === "blocked" && !draft.blocked);
              const optional = column.status_key === "backlog" || column.status_key === "blocked";
              const middleIndex = draft.middle.findIndex((c) => c.id === column.id);
              return (
                <ColumnRow
                  key={column.id}
                  draftColumn={draftColumn}
                  statusKey={column.status_key}
                  pinned={pinned}
                  off={off}
                  optional={optional}
                  selected={column.id === selectedId}
                  isFirstMiddle={middleIndex === 0}
                  isLastMiddle={middleIndex === draft.middle.length - 1}
                  canEdit={canEdit}
                  handoff={off || !statusAcceptsHandoff(column.status_key) ? undefined : draft.handoffs[column.id]}
                  nextLabel={off ? "" : statusLabel(workflowNextStatus(draftFlow(draft), column.status_key))}
                  onSelect={() => setSelected(column.id)}
                  onToggle={(on) =>
                    setDraft((d) =>
                      toggleOptionalColumn(d, column.status_key as "backlog" | "blocked", on),
                    )
                  }
                  onMove={(delta) => setDraft((d) => moveColumn(d, column.id, delta))}
                  onRemove={() => {
                    setDraft((d) => removeColumn(d, column.id));
                    setSelected("todo");
                  }}
                />
              );
            })}
          </View>
          <Text className="text-caption text-muted-foreground">
            {t("workflow.editor.columnsHint")}
          </Text>

          {canEdit ? (
            <View className="gap-2 pt-1">
              <Pressable
                onPress={() => setAddingOpen((open) => !open)}
                accessibilityRole="button"
                className="flex-row items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2.5 active:bg-secondary"
              >
                <Ionicons name="add" size={16} color={theme.mutedForeground} />
                <Text className="text-body text-muted-foreground">
                  {t("workflow.editor.addColumn")}
                </Text>
              </Pressable>

              {addingOpen ? (
                <View className="rounded-md border border-border bg-card p-2">
                  {addable.map((key) => (
                    <Pressable
                      key={key}
                      onPress={() => {
                        setDraft((d) => addStatusColumn(d, key));
                        setSelected(key);
                        setAddingOpen(false);
                      }}
                      accessibilityRole="button"
                      className="flex-row items-center gap-2 rounded-md px-2 py-2.5 active:bg-secondary"
                    >
                      <StatusIcon status={key} category={categoryOf(key)} size={14} />
                      <Text className="min-w-0 flex-1 text-body text-foreground" numberOfLines={1}>
                        {statusLabel(key)}
                      </Text>
                    </Pressable>
                  ))}
                  {addable.length === 0 && !permissions.canCreateStatus ? (
                    <Text className="px-2 py-2 text-caption text-muted-foreground">
                      {t("workflow.editor.noOtherStatus")}
                    </Text>
                  ) : null}

                  {permissions.canCreateStatus ? (
                    newStatusName === null ? (
                      <Pressable
                        onPress={() => setNewStatusName("")}
                        accessibilityRole="button"
                        className="flex-row items-center gap-2 rounded-md px-2 py-2.5 active:bg-secondary"
                      >
                        <Ionicons name="add" size={14} color={theme.mutedForeground} />
                        <Text className="text-body text-foreground">
                          {t("workflow.editor.newStatus")}
                        </Text>
                      </Pressable>
                    ) : (
                      <View className="flex-row items-center gap-2 px-1 py-1">
                        <View className="flex-1">
                          <TextField
                            value={newStatusName}
                            onChangeText={setNewStatusName}
                            placeholder={t("workflow.editor.newStatusName")}
                            autoFocus
                            maxLength={WORKFLOW_NAME_MAX}
                          />
                        </View>
                        <Pressable
                          onPress={() => {
                            const name = newStatusName.trim();
                            if (!name) return;
                            setDraft((d) => addNewStatusColumn(d, name, "started"));
                            setSelected(`new:${name}`);
                            setNewStatusName(null);
                            setAddingOpen(false);
                          }}
                          accessibilityRole="button"
                          className="rounded-md bg-primary px-3 py-2 active:bg-primary/90"
                        >
                          <Text className="text-body text-primary-foreground">
                            {t("workflow.editor.newStatusSubmit")}
                          </Text>
                        </Pressable>
                      </View>
                    )
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          {missing.length > 0 ? (
            <Text accessibilityRole="alert" className="text-caption text-destructive">
              {t("workflow.editor.statusNeedsAdmin", {
                names: missing.join(t("workflow.listSeparator")),
              })}
            </Text>
          ) : null}
        </View>

        {/* ── The selected column's handoff ────────────────────────────── */}
        <View className="gap-2">
          <Text className="text-caption font-medium text-muted-foreground">
            {t("workflow.editor.onEnter")}
          </Text>
          {selectedOff ? (
            <Text className="text-caption text-muted-foreground">
              {t("workflow.editor.stepOff")}
            </Text>
          ) : !statusAcceptsHandoff(selectedColumn.status_key) && !selectedDraftColumnIsNew(selectedDraftColumn) ? (
            <Text className="text-caption text-muted-foreground">
              {t("workflow.editor.noHandoffStep")}
            </Text>
          ) : (
            <HandoffFields
              draft={{ status_key: selectedColumn.status_key, ...draftHandoff(draft, selectedId) }}
              canEdit={canEdit}
              targetKeys={targetKeys}
              defaultNextLabel={defaultNextLabel}
              onPatch={(patch) => setDraft((d) => patchHandoff(d, selectedId, patch))}
            />
          )}
        </View>

        {/* ── Removing the whole workflow ──────────────────────────────── */}
        {canEdit && !isNew && saved ? (
          <View className="gap-1.5 pt-2">
            {blocked.blocked ? (
              <Text className="text-caption text-muted-foreground">
                {blocked.reason === "default"
                  ? t("workflow.settings.deleteDefaultBlocked")
                  : t("workflow.settings.deleteInUse", { count: saved.project_ids.length })}
              </Text>
            ) : (
              <Pressable
                onPress={onDelete}
                disabled={remove.isPending}
                accessibilityRole="button"
                className="flex-row items-center gap-1.5 self-start rounded-md px-2 py-2 active:bg-secondary"
              >
                <Ionicons name="trash-outline" size={15} color={theme.destructive} />
                <Text className="text-body text-destructive">
                  {t("workflow.settings.delete")}
                </Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </ScrollView>

      <WorkflowMappingDialog
        pending={
          mappingPlan && saved
            ? {
                variant: { kind: "edit", workflowName: draft.name.trim() || saved.name },
                plan: mappingPlan,
                targetKeys,
              }
            : null
        }
        submitting={pending}
        onCancel={() => setMappingPlan(null)}
        onConfirm={(mapping) => {
          setMappingPlan(null);
          void save(mapping);
        }}
      />
    </>
  );
}

/** Whether the selected column is one the save will CREATE (and therefore one
 *  that always takes a handoff). */
function selectedDraftColumnIsNew(column: DraftColumn | undefined): boolean {
  return !!column && "new_name" in column;
}

function ColumnRow({
  draftColumn,
  statusKey,
  pinned,
  off,
  optional,
  selected,
  isFirstMiddle,
  isLastMiddle,
  canEdit,
  handoff,
  nextLabel,
  onSelect,
  onToggle,
  onMove,
  onRemove,
}: {
  draftColumn: DraftColumn | undefined;
  statusKey: string;
  pinned: boolean;
  off: boolean;
  optional: boolean;
  selected: boolean;
  isFirstMiddle: boolean;
  isLastMiddle: boolean;
  canEdit: boolean;
  handoff: ReturnType<typeof draftHandoff> | undefined;
  nextLabel: string;
  onSelect: () => void;
  onToggle: (on: boolean) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const theme = useThemePalette();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { categoryOf } = useIssueStatuses(wsId);
  const statusLabel = useStatusLabel(wsId);
  const { getName } = useActorLookup();

  const isNewColumn = !!draftColumn && "new_name" in draftColumn;
  const label = isNewColumn ? draftColumn.new_name : statusLabel(statusKey);
  const mode = handoff ? handoffModeOf(handoff.handler) : "none";
  const actor =
    handoff &&
    (handoff.handler.type === "agent" ||
      handoff.handler.type === "squad" ||
      handoff.handler.type === "member") &&
    handoff.handler.id
      ? { type: handoff.handler.type, id: handoff.handler.id }
      : null;

  return (
    <View
      className={cn(
        "border-b border-border/60 last:border-b-0",
        selected && "bg-secondary/60",
        off && "opacity-60",
      )}
    >
      <View className="flex-row items-center gap-1 px-2 py-2.5">
        {/* Reorder handles — the middle only. A pinned column keeps the place
            the server gives it, so its column shows an inert spacer instead of
            a control that would do nothing. */}
        {!pinned && canEdit ? (
          // 28dp visual rows with a 44dp touch target (the two hitSlops meet in
          // the middle), so a thumb can reorder without aiming. A drag handle
          // would be the web answer, but a drag list inside a scrolling form
          // fights the scroll — every other orderable list here uses the same
          // pair of arrows (`more/settings/issue-statuses.tsx`).
          <View className="w-5 items-center">
            <Pressable
              onPress={() => onMove(-1)}
              disabled={isFirstMiddle}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityState={{ disabled: isFirstMiddle }}
              accessibilityLabel={t("workflow.editor.moveUp", { name: label })}
              className="py-1"
            >
              <Ionicons
                name="chevron-up"
                size={14}
                color={isFirstMiddle ? theme.border : theme.mutedForeground}
              />
            </Pressable>
            <Pressable
              onPress={() => onMove(1)}
              disabled={isLastMiddle}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityState={{ disabled: isLastMiddle }}
              accessibilityLabel={t("workflow.editor.moveDown", { name: label })}
              className="py-1"
            >
              <Ionicons
                name="chevron-down"
                size={14}
                color={isLastMiddle ? theme.border : theme.mutedForeground}
              />
            </Pressable>
          </View>
        ) : (
          <View className="w-5" />
        )}

        <Pressable
          onPress={onSelect}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          accessibilityLabel={t("workflow.editor.columnAria", { name: label })}
          className="min-w-0 flex-1 py-0.5 active:opacity-70"
        >
          <View className="flex-row items-center gap-2">
            {isNewColumn ? (
              <Ionicons name="add-circle-outline" size={13} color={theme.mutedForeground} />
            ) : (
              <StatusIcon status={statusKey} category={categoryOf(statusKey)} size={13} />
            )}
            <Text className="min-w-0 shrink text-body font-medium text-foreground" numberOfLines={1}>
              {label}
            </Text>
            {statusKey === "todo" ? (
              <View className="rounded-full bg-secondary px-1.5 py-0.5">
                <Text className="text-micro text-muted-foreground">
                  {t("workflow.editor.start")}
                </Text>
              </View>
            ) : null}
            {isNewColumn ? (
              <View className="rounded-full bg-secondary px-1.5 py-0.5">
                <Text className="text-micro text-muted-foreground">
                  {t("workflow.editor.newBadge")}
                </Text>
              </View>
            ) : null}
          </View>
          <View className="mt-0.5 flex-row items-center gap-1">
            {off ? (
              <Text className="text-caption text-muted-foreground">
                {t("workflow.editor.stepOffShort")}
              </Text>
            ) : actor ? (
              <>
                <Ionicons name="return-down-forward-outline" size={11} color={theme.mutedForeground} />
                <ActorAvatar type={actor.type} id={actor.id} size={14} />
                <Text className="min-w-0 shrink text-caption text-foreground" numberOfLines={1}>
                  {getName(actor.type, actor.id)}
                </Text>
                {handoff && (handoff.handler.type === "agent" || handoff.handler.type === "squad") && nextLabel ? (
                  <Text className="shrink text-caption text-muted-foreground" numberOfLines={1}>
                    · {t("workflow.editor.thenTo", { status: nextLabel })}
                  </Text>
                ) : null}
              </>
            ) : mode === "none" ? (
              <Text className="text-caption text-muted-foreground">
                {t("workflow.editor.noHandoff")}
              </Text>
            ) : (
              <Text className="text-caption text-muted-foreground">{label}</Text>
            )}
          </View>
        </Pressable>

        {!pinned && canEdit ? (
          <Pressable
            onPress={onRemove}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t("workflow.editor.remove", { name: label })}
            className="p-1 active:opacity-60"
          >
            <Ionicons name="trash-outline" size={14} color={theme.mutedForeground} />
          </Pressable>
        ) : null}

        {optional ? (
          <Switch
            checked={!off}
            disabled={!canEdit}
            onCheckedChange={onToggle}
            accessibilityLabel={t("workflow.editor.includeStatus", { status: label })}
          />
        ) : null}
      </View>
    </View>
  );
}
