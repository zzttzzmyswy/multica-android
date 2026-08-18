/**
 * Issue statuses management subscreen — mobile port of web's
 * `packages/views/settings/components/issue-statuses-tab.tsx` (MUL-6243).
 *
 * Organised by CATEGORY, not as one flat list: category is the behavior a
 * status inherits, and picking it is the one moment an admin can, since it is
 * immutable afterwards. The 7 built-ins are shown but locked — each is its
 * category's canonical definition. Custom statuses can be created
 * (name/category/color/description — key auto-derived by the server), edited
 * (name/desc/color; key+category immutable), archived (retires from future
 * assignment; existing issues keep it), and reordered within their category
 * via up/down buttons (a single atomic reorder PATCH covers a category's
 * whole order).
 *
 * Writes are owner/admin only. The create affordance is hidden once the
 * backend answers 403 (rollout flag `custom_issue_statuses` off), and an
 * inline notice explains why. A backend that predates the endpoint entirely
 * shows the same built-in list with the create action available — the server
 * will 403 any create, surfacing the same notice.
 */
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type {
  IssueStatusCategory,
  IssueStatusEntry,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";
import { StatusIcon } from "@/components/ui/status-icon";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import {
  useArchiveIssueStatus,
  useCreateIssueStatus,
  useReorderIssueStatuses,
  useUpdateIssueStatus,
} from "@/data/mutations/issue-statuses";
import { memberListOptions } from "@/data/queries/members";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { ApiError } from "@/data/api";
import {
  ISSUE_STATUS_CATEGORIES,
  isIssueStatusCategory,
} from "@/lib/issue-status-catalog";
import { useStatusLabel } from "@/lib/status-options";
import { LABEL_COLOR_PRESETS } from "@/components/label/label-form";
import { useTranslation } from "@/lib/i18n/react";
import { canManageRole } from "@/lib/member-guards";
import { cn } from "@/lib/utils";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

type EditorState =
  | {
      mode: "create";
      name: string;
      category: IssueStatusCategory;
      color: string;
      description: string;
    }
  | {
      mode: "edit";
      status: IssueStatusEntry;
      name: string;
      category: IssueStatusCategory;
      color: string;
      description: string;
    };

function emptyCreate(category: IssueStatusCategory): EditorState {
  return {
    mode: "create",
    name: "",
    category,
    color: LABEL_COLOR_PRESETS[6]!,
    description: "",
  };
}

export default function IssueStatusesSettingsScreen() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { t } = useTranslation();
  const statusLabel = useStatusLabel(wsId);
  const { statuses, activeStatuses, isLoaded, isError, retry } =
    useIssueStatuses(wsId);

  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const currentMember = members?.find((m) => m.user_id === currentUserId);
  const isManager = canManageRole(currentMember?.role);

  const create = useCreateIssueStatus();
  const update = useUpdateIssueStatus();
  const archive = useArchiveIssueStatus();
  const reorder = useReorderIssueStatuses();

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [flagBlocked, setFlagBlocked] = useState(false);
  const [saving, setSaving] = useState(false);

  // All statuses per category — the catalog keeps archived rows, so a section
  // always renders its built-in + custom entries (archived badges included).
  const byCategory = useMemo(() => {
    const map = new Map<IssueStatusCategory, IssueStatusEntry[]>(
      ISSUE_STATUS_CATEGORIES.map((c) => [c, []]),
    );
    for (const entry of statuses) {
      if (isIssueStatusCategory(entry.category)) {
        map.get(entry.category)?.push(entry);
      }
    }
    return map;
  }, [statuses]);

  const saveEditor = useCallback(() => {
    if (!editor) return;
    const name = editor.name.trim();
    if (!name) return;
    setSaving(true);
    const success = () => {
      setSaving(false);
      setEditor(null);
    };
    const onError = (error: unknown) => {
      setSaving(false);
      if (error instanceof ApiError && error.status === 403) {
        setFlagBlocked(true);
        setEditor(null);
      }
    };

    if (editor.mode === "create") {
      create.mutate(
        {
          name,
          description: editor.description.trim(),
          category: editor.category,
          color: editor.color,
        },
        { onSuccess: success, onError },
      );
      return;
    }
    update.mutate(
      {
        id: editor.status.id,
        name,
        description: editor.description.trim(),
        color: editor.color,
      },
      { onSuccess: success, onError },
    );
  }, [create, editor, update]);

  const confirmArchive = (entry: IssueStatusEntry) => {
    Alert.alert(
      t("settings.statuses.archiveTitle"),
      t("settings.statuses.archiveMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("settings.statuses.actions.archive"),
          style: "destructive",
          onPress: () => archive.mutate(entry.id),
        },
      ],
    );
  };

  const moveCustom = (
    category: IssueStatusCategory,
    entry: IssueStatusEntry,
    delta: -1 | 1,
  ) => {
    const active = activeStatuses.filter(
      (e) => e.category === category && !e.archived_at,
    );
    const index = active.findIndex((e) => e.id === entry.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= active.length) return;
    const next = [...active];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    reorder.mutate({ category, ordered: next });
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-4 gap-6"
      contentInsetAdjustmentBehavior="automatic"
    >
      <Stack.Screen options={{ title: t("settings.issueStatusesTitle") }} />

      <Text className="text-sm text-muted-foreground px-1">
        {t("settings.statuses.description")}
      </Text>

      {flagBlocked ? (
        <View className="rounded-md border border-border bg-muted/50 px-3 py-2.5">
          <Text className="text-xs text-muted-foreground">
            {t("settings.statuses.flagOff")}
          </Text>
        </View>
      ) : null}

      {!isLoaded && !isError ? (
        <View className="py-12 items-center">
          <ActivityIndicator />
        </View>
      ) : isError ? (
        <View className="py-8 items-center gap-3">
          <Text className="text-sm text-destructive">
            {t("settings.workspacesLoadError")}
          </Text>
          <Button variant="outline" onPress={retry}>
            <Text>{t("common.retry")}</Text>
          </Button>
        </View>
      ) : (
        <>
          {isManager && !flagBlocked && !editor ? (
            <Pressable
              onPress={() => setEditor(emptyCreate("todo"))}
              className="flex-row items-center justify-center gap-2 rounded-md border border-dashed border-border py-3 active:bg-secondary"
            >
              <Ionicons name="add" size={18} color="#64748b" />
              <Text className="text-sm text-muted-foreground">
                {t("settings.statuses.add")}
              </Text>
            </Pressable>
          ) : null}

          {editor ? (
            <EditorPanel
              editor={editor}
              saving={saving}
              onChange={setEditor}
              onSave={() => saveEditor()}
              onCancel={() => setEditor(null)}
            />
          ) : null}

          {ISSUE_STATUS_CATEGORIES.map((category) => {
            const entries = byCategory.get(category) ?? [];
            const custom = entries.filter((e) => e.is_system !== true);
            const activeCustom = custom.filter((e) => !e.archived_at);
            return (
              <View key={category} className="gap-2">
                <View className="px-1">
                  <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                    {statusLabel(category)}
                  </Text>
                </View>
                <View className="rounded-md border border-border bg-card overflow-hidden">
                  <BuiltInRow
                    label={statusLabel(category)}
                    builtIn={entries.find((e) => e.is_system === true)}
                  />
                  {custom.map((entry) => {
                    const activeIndex = activeCustom.findIndex(
                      (e) => e.id === entry.id,
                    );
                    return (
                      <StatusRow
                        key={entry.id}
                        entry={entry}
                        archived={!!entry.archived_at}
                        isManager={isManager}
                        canMoveUp={isManager && activeIndex > 0}
                        canMoveDown={
                          isManager &&
                          activeIndex >= 0 &&
                          activeIndex < activeCustom.length - 1
                        }
                        onEdit={() =>
                          setEditor({
                            mode: "edit",
                            status: entry,
                            name: entry.name,
                            category: entry.category,
                            color: entry.color,
                            description: entry.description ?? "",
                          })
                        }
                        onArchive={() => confirmArchive(entry)}
                        onMoveUp={() => moveCustom(category, entry, -1)}
                        onMoveDown={() => moveCustom(category, entry, 1)}
                      />
                    );
                  })}
                </View>
              </View>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

function BuiltInRow({
  label,
  builtIn,
}: {
  label: string;
  builtIn: IssueStatusEntry | undefined;
}) {
  const { t } = useTranslation();
  // A server that predates the catalog feeds no entry — the category key IS
  // the built-in then, and its token color applies.
  const statusKey = builtIn?.key ?? label;
  const category = builtIn?.category ?? (isIssueStatusCategory(label) ? label : "todo");
  return (
    <View className="flex-row items-center gap-3 px-3 py-3">
      <StatusIcon status={statusKey} category={category} size={16} />
      <Text className="flex-1 text-sm text-foreground">{label}</Text>
      <View className="rounded-full bg-secondary/70 px-2 py-0.5">
        <Text className="text-[10px] text-muted-foreground">
          {t("settings.statuses.builtInLocked")}
        </Text>
      </View>
    </View>
  );
}

function StatusRow({
  entry,
  archived,
  isManager,
  canMoveUp,
  canMoveDown,
  onEdit,
  onArchive,
  onMoveUp,
  onMoveDown,
}: {
  entry: IssueStatusEntry;
  archived: boolean;
  isManager: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="border-t border-border/60 px-3 py-3 gap-2">
      <View className="flex-row items-center gap-3">
        <StatusIcon
          status={entry.key}
          category={entry.category}
          color={entry.color}
          size={16}
        />
        <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
          {entry.name}
        </Text>
        {archived ? (
          <View className="rounded-full bg-muted px-2 py-0.5">
            <Text className="text-[10px] text-muted-foreground">
              {t("settings.statuses.archivedBadge")}
            </Text>
          </View>
        ) : null}
      </View>
      {entry.description ? (
        <Text className="text-xs text-muted-foreground" numberOfLines={2}>
          {entry.description}
        </Text>
      ) : null}
      {isManager ? (
        <View className="flex-row items-center gap-4 ps-1 pt-1">
          {!archived ? (
            <>
              <RowAction
                icon="chevron-up"
                labelKey="settings.statuses.actions.moveUp"
                disabled={!canMoveUp}
                onPress={onMoveUp}
              />
              <RowAction
                icon="chevron-down"
                labelKey="settings.statuses.actions.moveDown"
                disabled={!canMoveDown}
                onPress={onMoveDown}
              />
            </>
          ) : null}
          <RowAction
            icon="pencil-outline"
            labelKey="settings.statuses.actions.edit"
            onPress={onEdit}
          />
          <RowAction
            icon="archive-outline"
            labelKey="settings.statuses.actions.archive"
            onPress={onArchive}
          />
        </View>
      ) : null}
    </View>
  );
}

function RowAction({
  icon,
  labelKey,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const color = THEME[colorScheme].mutedForeground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="flex-row items-center gap-1 py-1 active:opacity-60"
      accessibilityLabel={t(labelKey)}
    >
      <Ionicons
        name={icon}
        size={14}
        color={disabled ? "#a1a1aa" : color}
      />
      <Text
        className={`text-xs ${
          disabled ? "text-muted-foreground/50" : "text-muted-foreground"
        }`}
      >
        {t(labelKey)}
      </Text>
    </Pressable>
  );
}

function EditorPanel({
  editor,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  editor: EditorState;
  saving: boolean;
  onChange: (next: EditorState) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [showErrors, setShowErrors] = useState(false);

  const editing = editor.mode === "edit";
  const nameMissing = editor.name.trim().length === 0;

  const selectCategory = (next: IssueStatusCategory) => {
    if (editing) return;
    onChange({ ...editor, category: next });
  };

  return (
    <View className="rounded-md border border-border bg-card p-4 gap-4">
      <Text className="text-base font-semibold text-foreground">
        {t(
          editing
            ? "settings.statuses.editor.titleEdit"
            : "settings.statuses.editor.titleCreate",
        )}
      </Text>

      <View className="gap-1.5">
        <Text className="text-sm text-muted-foreground">
          {t("settings.statuses.editor.name")}
        </Text>
        <TextField
          value={editor.name}
          onChangeText={(name) => onChange({ ...editor, name })}
          placeholder={t("settings.statuses.editor.namePlaceholder")}
          invalid={showErrors && nameMissing}
          editable={!saving}
        />
        {showErrors && nameMissing ? (
          <Text className="text-xs text-destructive">
            {t("settings.statuses.editor.nameRequired")}
          </Text>
        ) : null}
        {!editing ? (
          <Text className="text-xs text-muted-foreground/60">
            {t("settings.statuses.editor.keyHint")}
          </Text>
        ) : null}
      </View>

      <View className="gap-1.5">
        <Text className="text-sm text-muted-foreground">
          {t("settings.statuses.editor.category")}
        </Text>
        <Text className="text-xs text-muted-foreground/60">
          {t("settings.statuses.editor.categoryHint")}
        </Text>
        <View className="flex-row flex-wrap gap-1.5 pt-1">
          {ISSUE_STATUS_CATEGORIES.map((c) => {
            const selected = editor.category === c;
            return (
              <Pressable
                key={c}
                onPress={() => selectCategory(c)}
                disabled={editing || saving}
                className={cn(
                  "flex-row items-center gap-1.5 rounded-full border px-2.5 py-1.5",
                  selected ? "border-foreground bg-secondary" : "border-border",
                )}
              >
                <StatusIcon status={c} size={12} />
                <Text
                  className={cn(
                    "text-xs",
                    selected ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {t(`enum.status.${c}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View className="gap-1.5">
        <Text className="text-sm text-muted-foreground">
          {t("settings.statuses.editor.color")}
        </Text>
        <View className="flex-row flex-wrap gap-3 pt-1">
          {LABEL_COLOR_PRESETS.map((preset) => {
            const selected = preset === editor.color;
            return (
              <Pressable
                key={preset}
                onPress={() => {
                  if (!saving) onChange({ ...editor, color: preset });
                }}
                accessibilityLabel={preset}
                accessibilityState={{ selected }}
                className={cn(
                  "size-8 rounded-full items-center justify-center border",
                  selected
                    ? "border-foreground scale-110"
                    : "border-foreground/15",
                )}
                style={{ backgroundColor: preset }}
              />
            );
          })}
        </View>
        <Text className="text-xs text-muted-foreground/70">{editor.color}</Text>
      </View>

      <View className="gap-1.5">
        <Text className="text-sm text-muted-foreground">
          {t("settings.statuses.editor.description")}
        </Text>
        <TextField
          value={editor.description}
          onChangeText={(description) =>
            onChange({ ...editor, description })
          }
          multiline
          editable={!saving}
        />
      </View>

      <View className="flex-row justify-end gap-3 pt-1">
        <Button variant="ghost" onPress={onCancel} disabled={saving}>
          <Text>{t("settings.statuses.editor.cancel")}</Text>
        </Button>
        <Button
          onPress={() => {
            setShowErrors(true);
            onSave();
          }}
          disabled={saving}
        >
          <Text>{t("settings.statuses.editor.save")}</Text>
        </Button>
      </View>
    </View>
  );
}