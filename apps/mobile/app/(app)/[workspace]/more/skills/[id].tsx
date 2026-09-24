/**
 * Skill detail screen. Reached from the skills list row. Mirrors web
 * `packages/views/skills/components/skill-detail-page.tsx` read + manage
 * surface on a phone:
 *
 *   identity card    — icon, name, provenance badge, description
 *   meta rows        — source (origin badge), creator (member name), updated
 *                      (relative time)
 *   SKILL.md content — rendered read-only via the shared mobile Markdown
 *                      renderer (empty → muted placeholder)
 *   attached files   — list of non-SKILL.md files (web names it "Files"):
 *                      tapping opens a read-only preview sheet (markdown →
 *                      Markdown renderer, everything else → monospace text).
 *                      Editable skills also get a "New file" entry and a "⋯"
 *                      on every attached row (rename / delete), matching web's
 *                      AddFileInline + FileTree row menu.
 *
 * File-set edits are a DRAFT, committed as one write. The server has no
 * per-file endpoint — web adds, renames and deletes in local state and PUTs the
 * whole skill when Save is pressed, and `skill.go UpdateSkill` replaces the file
 * set wholesale (`files != nil` ⇒ delete + upsert all). So the same shape holds
 * here: `fileDraft` holds the pending set, the save bar (or a save from the file
 * editor, which sends the draft too) commits it, and Discard drops it. Without
 * the draft an added row would vanish on the next re-render, since `files` is
 * read straight off the server object.
 *
 * Management gate mirrors `canEditSkill` (lib/skill-guards.ts + web
 * use-can-edit-skill): workspace owner/admin manage every skill; a regular
 * member manages only skills they created. When editable, an edit button
 * opens a bottom sheet with the shared SkillForm (rename/describe/delete,
 * delete double-confirmed). Otherwise the edit affordance is hidden entirely
 * — the server remains the authoritative gate.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Label } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { SkillForm } from "@/components/skill/skill-form";
import { SkillFileEditor } from "@/components/skill/skill-file-editor";
import { SkillFileTree } from "@/components/skill/skill-file-tree";
import { TextField } from "@/components/ui/text-field";
import { LabelPickerBody } from "@/components/issue/pickers/label-picker-body";
import { skillDetailOptions } from "@/data/queries/skills";
import { memberListOptions } from "@/data/queries/members";
import { labelKeys, resourceLabelsOptions } from "@/data/queries/labels";
import {
  useAttachResourceLabel,
  useCreateLabel,
  useDetachResourceLabel,
} from "@/data/mutations/labels";
import { useRefreshSkill, useUpdateSkill } from "@/data/mutations/skills";
import { agentListOptions, agentKeys } from "@/data/queries/agents";
import { api } from "@/data/api";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { MultiSelectSheet } from "@/components/agent/multi-select-sheet";
import {
  agentsForSkill,
  partitionAgentsForSkill,
} from "@/lib/skill-used-by";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import {
  canEditSkill,
  isRefreshableOrigin,
  ORIGIN_LABEL_KEY,
  readOrigin,
} from "@/lib/skill-guards";
import {
  SKILL_MD,
  skillPathSet,
  validateSkillFilePath,
  type SkillFileDraft,
  type SkillFilePathError,
} from "@/lib/skill-file-paths";
import { useSkillRole } from "@/lib/use-skill-role";
import { useTimeAgo } from "@/lib/time-ago";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { Markdown } from "@/lib/markdown";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function isMarkdownPath(path: string): boolean {
  return path.endsWith(".md") || path.endsWith(".mdx");
}

/** i18n for the seven path rejections the validator returns. */
const PATH_ERROR_KEY: Record<SkillFilePathError, string> = {
  empty: "skills.detail.add_file.errors.empty",
  absolute: "skills.detail.add_file.errors.absolute",
  double_dot: "skills.detail.add_file.errors.double_dot",
  reserved: "skills.detail.add_file.errors.reserved",
  exists: "skills.detail.add_file.errors.exists",
  is_directory: "skills.detail.add_file.errors.is_directory",
  under_file: "skills.detail.add_file.errors.under_file",
};

/** Same paths, same contents, same order — i.e. nothing to commit. */
function sameFiles(a: SkillFileDraft[], b: SkillFileDraft[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((f, i) => f.path === b[i]!.path && f.content === b[i]!.content);
}

/**
 * Inline "new file" row (web `AddFileInline`,
 * skill-detail-page.tsx:213-255). Validation runs on submit and the message
 * stays put until the path changes, so a rejected path is not silently eaten.
 */
function AddFileInline({
  existingPaths,
  onAdd,
  onCancel,
}: {
  existingPaths: string[];
  onAdd: (path: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [error, setError] = useState<SkillFilePathError | null>(null);

  const submit = () => {
    const err = validateSkillFilePath(path, existingPaths);
    if (err) {
      setError(err);
      return;
    }
    onAdd(path.trim());
  };

  return (
    <View className="rounded-lg border border-border bg-card px-3 py-2.5 gap-2">
      <TextField
        autoFocus
        value={path}
        onChangeText={(next) => {
          setPath(next);
          setError(null);
        }}
        placeholder={t("skills.detail.add_file.placeholder")}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        invalid={!!error}
        onSubmitEditing={submit}
      />
      {error ? (
        <Text className="text-xs text-destructive">{t(PATH_ERROR_KEY[error])}</Text>
      ) : null}
      <View className="flex-row items-center gap-2">
        <Button size="sm" onPress={submit} className="flex-1">
          <Text>{t("skills.detail.add_file.add")}</Text>
        </Button>
        <Button variant="outline" size="sm" onPress={onCancel} className="flex-1">
          <Text>{t("skills.detail.add_file.cancel")}</Text>
        </Button>
      </View>
    </View>
  );
}

function SectionTitle({
  icon,
  title,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
}) {
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  return (
    <View className="flex-row items-center gap-1.5">
      <Ionicons name={icon} size={14} color={muted} />
      <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {title}
      </Text>
    </View>
  );
}

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
}) {
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  return (
    <View className="flex-row items-start gap-2 py-1.5">
      <Ionicons name={icon} size={14} color={muted} style={{ marginTop: 1 }} />
      <Text className="text-xs text-muted-foreground w-16">{label}</Text>
      <Text className="text-xs text-foreground flex-1" numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

/** One attached-label chip: color dot + name (web `LabelChip` equivalent). */
function LabelChip({ label }: { label: Label }) {
  const { colorScheme } = useColorScheme();
  const text =
    colorScheme === "dark" ? THEME.dark.foreground : THEME.light.foreground;
  return (
    <View className="flex-row items-center gap-1 self-start rounded-full border border-border px-2 py-0.5">
      <View
        className="size-2 rounded-full"
        style={{ backgroundColor: label.color }}
      />
      <Text className="text-[11px]" style={{ color: text }} numberOfLines={1}>
        {label.name}
      </Text>
    </View>
  );
}

export default function SkillDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const insets = useSafeAreaInsets();
  const role = useSkillRole(wsId);
  const timeAgo = useTimeAgo();

  const { data, isLoading, error, refetch } = useQuery(skillDetailOptions(wsId, id));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: skillLabels = [] } = useQuery(
    resourceLabelsOptions(wsId, "skill", id),
  );
  const [editing, setEditing] = useState(false);
  // Path of the attached file open in the preview sheet; null = closed. The
  // content is looked up from the live file set rather than copied, so a
  // rename or a draft edit is reflected in the open sheet.
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  // Path highlighted in the rail. Kept explicitly (rather than derived from
  // whichever sheet is open) so a rename can follow the file to its new path
  // and a delete can fall back to SKILL.md, exactly as web's `selectedPath`
  // does.
  const [selectedPath, setSelectedPath] = useState<string>(SKILL_MD);
  // Pending attached-file set. null = no local edits, mirror the server.
  const [fileDraft, setFileDraft] = useState<SkillFileDraft[] | null>(null);
  const [addingFile, setAddingFile] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<SkillFilePathError | null>(null);
  const [filesSaving, setFilesSaving] = useState(false);
  // The rename sheet's buttons sit at the bottom of a Modal, which Android
  // draws in its own window — KeyboardAvoidingView does not lift it, so the
  // sheet pads itself (same manual lift as SkillFileEditor's footer).
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  // Path of the file currently open in the full-screen editor (SKILL.md or an
  // attached file); null = closed. The editor modal is conditionally mounted
  // with key={editingFile} so each open re-seeds from the latest server skill.
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [labelsQuery, setLabelsQuery] = useState("");
  const [addAgentsOpen, setAddAgentsOpen] = useState(false);
  const [agentSelection, setAgentSelection] = useState<Set<string>>(new Set());
  const qc = useQueryClient();
  const attachLabel = useAttachResourceLabel("skill", id);
  const detachLabel = useDetachResourceLabel("skill", id);
  const createLabel = useCreateLabel();
  const refreshSkill = useRefreshSkill();
  const updateSkill = useUpdateSkill();

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) =>
      setKeyboardHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardHeight(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Opening the add row focuses it, which raises the IME — and Android runs
  // edge-to-edge, so the window never resizes and nothing scrolls the row out
  // from under the keyboard on its own. KeyboardAvoidingView only shrinks the
  // viewport; the offset has to be moved explicitly. The Files section is the
  // last block in this ScrollView, so scrolling to the end is exactly the
  // add row; the delay lets the IME finish animating first.
  useEffect(() => {
    if (!addingFile) return;
    const timer = setTimeout(
      () => scrollRef.current?.scrollToEnd({ animated: true }),
      300,
    );
    return () => clearTimeout(timer);
  }, [addingFile]);

  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const isAdmin = role === "owner" || role === "admin";
  const usedByAgents = useMemo(
    () => agentsForSkill(agents, id),
    [agents, id],
  );
  const { mine: myAgents, others: otherAgents } = useMemo(
    () => partitionAgentsForSkill(agents, userId ?? null, isAdmin),
    [agents, userId, isAdmin],
  );

  const skill = data;
  const canEdit = canEditSkill(skill, { userId, role });
  const creatorName = useMemo(() => {
    if (!skill?.created_by) return null;
    return members.find((m) => m.user_id === skill.created_by)?.name ?? null;
  }, [skill?.created_by, members]);

  const origin = skill ? readOrigin(skill) : null;
  // The server's file rows carry id/skill_id/timestamps this screen never
  // sends; project them onto the draft shape once per skill object so the
  // array identity stays stable across renders.
  const serverFiles = useMemo<SkillFileDraft[]>(
    () => (skill?.files ?? []).map(({ path, content }) => ({ path, content })),
    [skill?.files],
  );
  const files = fileDraft ?? serverFiles;
  // Non-null draft that differs from the server ⇒ something to commit.
  const filesDirty = fileDraft !== null && !sameFiles(fileDraft, serverFiles);
  // Every path the tree renders, main file included: the validator needs the
  // full set, since SKILL.md participates in the nesting rules like any file.
  const filePaths = useMemo(() => skillPathSet(files), [files]);
  const previewFile = useMemo(
    () => (previewPath ? (files.find((f) => f.path === previewPath) ?? null) : null),
    [files, previewPath],
  );
  const refreshable = !!skill && !!origin && canEdit && isRefreshableOrigin(origin);

  const addAgentGroups = useMemo(() => {
    const bound = new Set(usedByAgents.map((a) => a.id));
    const toRow = (a: (typeof agents)[number]) => ({
      key: a.id,
      title: a.name,
      subtitle: a.description || undefined,
    });
    return [
      {
        label: t("skills.usedBy.mine"),
        rows: myAgents.filter((a) => !bound.has(a.id)).map(toRow),
      },
      {
        label: t("skills.usedBy.others"),
        rows: otherAgents.filter((a) => !bound.has(a.id)).map(toRow),
      },
    ];
  }, [myAgents, otherAgents, usedByAgents, t]);

  /** Common open entry: SKILL.md opens straight in the editor (its read view
   *  is the SKILL.md card above), other files open the preview sheet, whose
   *  edit affordance hands them to the same editor. */
  const openFile = (path: string) => {
    setSelectedPath(path);
    if (path === SKILL_MD) {
      setEditingFile(SKILL_MD);
    } else {
      setPreviewPath(path);
    }
  };

  /** Commit the whole skill with `next` as its file set. */
  const commitFiles = async (next: SkillFileDraft[]) => {
    if (!skill) return;
    setFilesSaving(true);
    try {
      await updateSkill.mutateAsync({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        content: skill.content,
        files: next,
      });
      // Hand the source of truth back to the server: `useUpdateSkill`
      // invalidates the detail query, so the refetch is authoritative and a
      // kept draft would only mask it.
      setFileDraft(null);
      Alert.alert(t("skills.detail.saveBar.saved"));
    } catch (err) {
      Alert.alert(
        t("skills.detail.saveBar.saveFailed"),
        err instanceof Error ? err.message : t("common.unknownError"),
      );
    } finally {
      setFilesSaving(false);
    }
  };

  const handleAddFile = (path: string) => {
    setFileDraft([...files, { path, content: "" }]);
    setAddingFile(false);
    setSelectedPath(path);
  };

  const handleRenameFile = (from: string, to: string) => {
    if (from === SKILL_MD) return;
    setFileDraft(files.map((f) => (f.path === from ? { ...f, path: to } : f)));
    // Follow the file: the rail, the preview and the editor are all keyed by
    // path, so leaving any of them on the old one points at a row that is gone.
    if (selectedPath === from) setSelectedPath(to);
    if (previewPath === from) setPreviewPath(to);
    if (editingFile === from) setEditingFile(to);
  };

  const handleDeleteFile = (path: string) => {
    if (path === SKILL_MD) return;
    setFileDraft(files.filter((f) => f.path !== path));
    // Fall back to the main file (web `handleDeleteFile`): the rail must not
    // keep pointing at a deleted row.
    if (selectedPath === path) setSelectedPath(SKILL_MD);
    if (previewPath === path) setPreviewPath(null);
    if (editingFile === path) setEditingFile(null);
  };

  const startRename = (path: string) => {
    setRenameTarget(path);
    setRenameValue(path);
    setRenameError(null);
  };

  const submitRename = () => {
    if (!renameTarget) return;
    const next = renameValue.trim();
    if (next === renameTarget) {
      setRenameTarget(null);
      return;
    }
    // The row's own path is not "taken" — it is the one being replaced.
    const err = validateSkillFilePath(
      next,
      filePaths.filter((path) => path !== renameTarget),
    );
    if (err) {
      setRenameError(err);
      return;
    }
    handleRenameFile(renameTarget, next);
    setRenameTarget(null);
  };

  const confirmAddAgents = async () => {
    const targets = [...myAgents, ...otherAgents].filter((a) =>
      agentSelection.has(a.id),
    );
    setAddAgentsOpen(false);
    setAgentSelection(new Set());
    // Incremental attach per target (web AddToAgentDialog.handleConfirm):
    // skip agents that already have the skill — the endpoint upserts with
    // ON CONFLICT DO NOTHING so repeats are harmless, but skipping avoids
    // pointless writes.
    const pending = targets.filter((a) => !a.skills.some((s) => s.id === id));
    let lastError: Error | null = null;
    for (const agent of pending) {
      try {
        await api.addAgentSkills(agent.id, { skill_ids: [id] });
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    if (pending.length > 0 && !lastError) {
      Alert.alert(
        pending.length === 1 && pending[0]
          ? t("skills.usedBy.addedOne", { name: pending[0].name })
          : t("skills.usedBy.addedMulti", { count: pending.length }),
      );
    } else if (lastError) {
      Alert.alert(
        t("skills.usedBy.addFailed"),
        lastError.message || t("common.unknownError"),
      );
    }
    void qc.invalidateQueries({ queryKey: agentKeys.list(wsId) });
    void qc.invalidateQueries({ queryKey: agentKeys.listAll(wsId) });
  };

  const handleRefresh = () => {
    if (!skill || !origin || refreshSkill.isPending) return;
    const source = t(ORIGIN_LABEL_KEY[origin.type]);
    const body = t("skills.detail.refreshConfirmBody", {
      name: skill.name,
      source,
    });
    Alert.alert(t("skills.detail.refreshConfirmTitle"), `${body}\n\n${t("skills.detail.refreshConfirmWarning")}`, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("skills.detail.refresh"),
        onPress: () => {
          refreshSkill.mutate(skill.id, {
            onSuccess: () => {
              Alert.alert(t("skills.detail.refreshSuccess", { source }));
            },
            onError: (err) =>
              Alert.alert(
                t("skills.detail.refreshFailed"),
                err instanceof Error ? err.message : t("common.unknownError"),
              ),
          });
        },
      },
    ]);
  };

  // Early returns live BELOW every hook on purpose: a return above
  // `addAgentGroups` made the first render (loading, fewer hooks) and the
  // loaded render (more hooks) disagree, which React reports as "Rendered
  // more hooks than during the previous render" — a hard crash every time the
  // skill detail was opened without a warm detail cache.
  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !skill || !skill.id) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6 gap-3">
        <Ionicons
          name="extension-puzzle-outline"
          size={32}
          color={theme.mutedForeground}
        />
        <Text className="text-sm text-muted-foreground text-center mt-2">
          {t("skills.notFound")}
        </Text>
        <Button variant="outline" onPress={() => refetch()}>
          <Text>{t("workspace.retry")}</Text>
        </Button>
      </View>
    );
  }

  const originInfo = origin!;

  return (
    <>
      {/* Android runs edge-to-edge: the window never resizes for the IME, so
          the ScrollView keeps its full height and its content still "fits" —
          nothing to scroll, and the inline add-file row's Add/Cancel buttons
          end up under the keyboard. KeyboardAvoidingView does not help here
          (measured: the viewport stays full-height), so the content is padded
          by the IME height instead. That makes the row reachable by hand and
          lets the scroll-to-end below actually land on it. */}
      <ScrollView
        ref={scrollRef}
        className="flex-1 bg-background"
        contentContainerClassName="pb-10"
        contentContainerStyle={{ paddingBottom: keyboardHeight + 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Identity card */}
        <View className="px-4 pt-4 gap-1">
          <View className="flex-row items-start gap-3">
            <View className="size-10 rounded-xl bg-secondary items-center justify-center mt-0.5">
              <Ionicons name="extension-puzzle" size={20} color={theme.mutedForeground} />
            </View>
            <View className="flex-1 min-w-0 gap-1">
              <View className="flex-row items-center gap-1.5 flex-wrap">
                <Text className="text-base font-semibold text-foreground">
                  {skill.name}
                </Text>
                <View className="px-1.5 py-px rounded-full bg-secondary">
                  <Text className="text-[10px] text-muted-foreground font-medium">
                    {t(ORIGIN_LABEL_KEY[originInfo.type])}
                  </Text>
                </View>
              </View>
              {skill.description ? (
                <Text className="text-sm text-muted-foreground/80">
                  {skill.description}
                </Text>
              ) : null}
              {/* Header counts — web's identity strip (`detail.header.files`
                  + `detail.header.used_by`, skill-detail-page.tsx). What the
                  skill is made of and who has it, without scrolling to the
                  Files / Used-by sections. */}
              <View className="flex-row flex-wrap items-center gap-3 pt-0.5">
                <View className="flex-row items-center gap-1">
                  <Ionicons
                    name="document-text-outline"
                    size={13}
                    color={theme.mutedForeground}
                  />
                  <Text className="text-xs text-muted-foreground">
                    {t("skills.detail.fileCount", { count: files.length + 1 })}
                  </Text>
                </View>
                <View className="flex-row items-center gap-1">
                  <Ionicons
                    name="people-outline"
                    size={13}
                    color={theme.mutedForeground}
                  />
                  <Text className="text-xs text-muted-foreground">
                    {usedByAgents.length === 1
                      ? t("skills.usedBy.title", { count: 1 })
                      : t("skills.usedBy.titleOther", {
                          count: usedByAgents.length,
                        })}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Meta rows */}
          <View className="mt-4 rounded-lg border border-border divide-y divide-border">
            <View className="px-3 py-1">
              <MetaRow
                icon="layers-outline"
                label={t("skills.detail.origin")}
                value={t(ORIGIN_LABEL_KEY[originInfo.type])}
              />
            </View>
            <View className="px-3 py-1">
              <MetaRow
                icon="person-outline"
                label={t("skills.detail.createdBy")}
                value={creatorName ?? t("skills.detail.unknownCreator")}
              />
            </View>
            {skill.updated_at ? (
              <View className="px-3 py-1">
                <MetaRow
                  icon="time-outline"
                  label={t("skills.detail.updatedAt")}
                  value={timeAgo(skill.updated_at)}
                />
              </View>
            ) : null}
            {/* Labels — attached skill labels as chips; taps open the picker
                sheet when the current member can edit (web Overview → Labels
                PropertyRow + ResourceLabelPicker). Read-only row otherwise. */}
            <View className="px-3 py-1.5">
              <Pressable
                onPress={() => canEdit && setShowLabels(true)}
                disabled={!canEdit}
                className="flex-row items-start gap-2"
                accessibilityLabel={t("skills.detail.labels")}
              >
                <Ionicons
                  name="pricetags-outline"
                  size={14}
                  color={theme.mutedForeground}
                  style={{ marginTop: 1 }}
                />
                <Text className="text-xs text-muted-foreground w-16">
                  {t("skills.detail.labels")}
                </Text>
                <View className="flex-1" pointerEvents={canEdit ? "none" : "box-none"}>
                  {skillLabels.length > 0 ? (
                    <View className="flex-row flex-wrap gap-1.5">
                      {skillLabels.map((label) => (
                        <LabelChip key={label.id} label={label} />
                      ))}
                    </View>
                  ) : (
                    <Text className="text-xs text-muted-foreground/70">
                      {t("skills.detail.noLabels")}
                    </Text>
                  )}
                </View>
                {canEdit ? (
                  <Ionicons
                    name="add"
                    size={16}
                    color={theme.mutedForeground}
                    style={{ marginTop: 1 }}
                  />
                ) : null}
              </Pressable>
            </View>
          </View>

          {canEdit ? (
            <View className="mt-3 flex-row items-center gap-2">
              {canEdit ? (
                <Pressable
                  onPress={() => setEditing(true)}
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-md border border-border px-3 py-2.5 active:bg-secondary"
                  accessibilityLabel={t("skills.detail.edit")}
                >
                  <Ionicons name="create-outline" size={15} color={theme.mutedForeground} />
                  <Text className="text-sm font-medium text-foreground">
                    {t("skills.detail.edit")}
                  </Text>
                </Pressable>
              ) : null}
              {refreshable ? (
                <Pressable
                  onPress={handleRefresh}
                  disabled={refreshSkill.isPending}
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-md border border-border px-3 py-2.5 active:bg-secondary"
                  accessibilityLabel={t("skills.detail.refresh")}
                >
                  {refreshSkill.isPending ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <Ionicons
                      name="refresh"
                      size={15}
                      color={theme.mutedForeground}
                    />
                  )}
                  <Text className="text-sm font-medium text-foreground">
                    {refreshSkill.isPending
                      ? t("skills.detail.refreshing")
                      : t("skills.detail.refresh")}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* Used by — agents with this skill bound (web skill-detail-page
            Overview "Used by" section). Header count + "Add to agent"
            affordance; rows show avatar, name, description. */}
        <View className="mt-6 px-4 gap-2">
          <View className="flex-row items-center justify-between gap-3">
            <SectionTitle
              icon="people-outline"
              title={
                usedByAgents.length === 1
                  ? t("skills.usedBy.title", { count: 1 })
                  : t("skills.usedBy.titleOther", { count: usedByAgents.length })
              }
            />
            <Pressable
              onPress={() => setAddAgentsOpen(true)}
              className="flex-row items-center gap-1 rounded-md border border-border px-2 py-1 active:bg-secondary"
              accessibilityLabel={t("skills.usedBy.add")}
            >
              <Ionicons
                name="person-add-outline"
                size={13}
                color={theme.mutedForeground}
              />
              <Text className="text-xs font-medium text-muted-foreground">
                {t("skills.usedBy.add")}
              </Text>
            </Pressable>
          </View>
          {usedByAgents.length === 0 ? (
            <View className="rounded-lg border border-dashed border-border px-3 py-6 items-center">
              <Text className="text-xs text-muted-foreground/70 italic text-center">
                {t("skills.usedBy.empty")}
              </Text>
            </View>
          ) : (
            <View className="rounded-lg border border-border divide-y divide-border bg-card">
              {usedByAgents.map((agent) => (
                <View key={agent.id} className="flex-row items-center gap-2.5 px-3 py-2.5">
                  <ActorAvatar type="agent" id={agent.id} size={28} />
                  <View className="flex-1 min-w-0">
                    <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                      {agent.name}
                    </Text>
                    {agent.description ? (
                      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                        {agent.description}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* SKILL.md */}
        <View className="mt-6 px-4 gap-2">
          <View className="flex-row items-center justify-between">
            <SectionTitle icon="document-text-outline" title={t("skills.detail.readme")} />
            {canEdit ? (
              <Pressable
                onPress={() => setEditingFile("SKILL.md")}
                className="flex-row items-center gap-1 rounded-md border border-border px-2 py-1 active:bg-secondary"
                accessibilityLabel={t("skills.editor.editFile")}
              >
                <Ionicons name="create-outline" size={13} color={theme.mutedForeground} />
                <Text className="text-xs font-medium text-muted-foreground">
                  {t("skills.editor.editFile")}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {skill.content?.trim() ? (
            <View className="rounded-lg border border-border px-3 py-2 bg-card">
              <Markdown content={skill.content} />
            </View>
          ) : (
            <View className="rounded-lg border border-dashed border-border px-3 py-6 items-center">
              <Text className="text-xs text-muted-foreground/70 italic">
                {t("skills.detail.noContent")}
              </Text>
            </View>
          )}
        </View>

        {/* Attached files */}
        <View className="mt-6 px-4 gap-2">
          <View className="flex-row items-center justify-between gap-3">
            <SectionTitle icon="folder-open-outline" title={t("skills.detail.files")} />
            {canEdit && !addingFile ? (
              <Pressable
                onPress={() => setAddingFile(true)}
                className="flex-row items-center gap-1 rounded-md border border-border px-2 py-1 active:bg-secondary"
                accessibilityLabel={t("skills.detail.add_file.newFile")}
              >
                <Ionicons name="add" size={13} color={theme.mutedForeground} />
                <Text className="text-xs font-medium text-muted-foreground">
                  {t("skills.detail.add_file.newFile")}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {files.length === 0 ? (
            <View className="rounded-lg border border-dashed border-border px-3 py-6 items-center">
              <Text className="text-xs text-muted-foreground/70 italic">
                {t("skills.detail.noFiles")}
              </Text>
            </View>
          ) : (
            <SkillFileTree
              paths={filePaths}
              selectedPath={selectedPath}
              onSelect={openFile}
              actions={
                canEdit
                  ? { onRename: startRename, onDelete: handleDeleteFile }
                  : undefined
              }
            />
          )}

          {/* Below the rail rather than above it (web puts AddFileInline on
              top): the sheet has to be the last thing in the ScrollView for the
              scroll-to-end above to land on it instead of overshooting past a
              long file list. */}
          {addingFile ? (
            <AddFileInline
              existingPaths={filePaths}
              onAdd={handleAddFile}
              onCancel={() => setAddingFile(false)}
            />
          ) : null}

          {/* Commit point for the draft. Delete is undoable only through
              Discard, which is why this bar appears the moment the set
              diverges from the server rather than only on a save attempt. */}
          {filesDirty ? (
            <View className="rounded-lg border border-border bg-card px-3 py-2.5 gap-2">
              <Text className="text-xs text-muted-foreground">
                {t("skills.detail.saveBar.changed")}
              </Text>
              <View className="flex-row items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={filesSaving}
                  onPress={() => setFileDraft(null)}
                  className="flex-1"
                >
                  <Text>{t("skills.detail.saveBar.discard")}</Text>
                </Button>
                <Button
                  size="sm"
                  disabled={filesSaving}
                  onPress={() => void commitFiles(files)}
                  className="flex-1"
                >
                  {filesSaving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text>{t("skills.detail.saveBar.save")}</Text>
                  )}
                </Button>
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Edit sheet — shared SkillForm (rename/describe/delete) */}
      <Modal
        visible={editing}
        transparent
        animationType="slide"
        onRequestClose={() => setEditing(false)}
      >
        <Pressable className="flex-1 bg-black/40" onPress={() => setEditing(false)} />
        <View className="h-[72%] bg-background rounded-t-2xl overflow-hidden">
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
            <Text className="text-sm font-semibold text-foreground">
              {t("skills.detail.edit")}
            </Text>
            <Pressable onPress={() => setEditing(false)} accessibilityLabel={t("a11y.close")}>
              <Ionicons name="close" size={20} color={theme.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView
            className="flex-1"
            contentContainerClassName="pb-10"
            keyboardShouldPersistTaps="handled"
          >
            <SkillForm
              skill={skill}
              canDelete={canEdit}
              onDone={() => setEditing(false)}
            />
          </ScrollView>
        </View>
      </Modal>

      {/* File preview sheet */}
      <Modal
        visible={previewFile !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setPreviewPath(null)}
      >
        <Pressable className="flex-1 bg-black/40" onPress={() => setPreviewPath(null)} />
        <View
          className="h-[75%] bg-background rounded-t-2xl overflow-hidden"
          // Bottom sheet draws under the status bar on Android; the header
          // needs its own inset so the (new) edit entry stays tappable.
          style={{ paddingTop: insets.top }}
        >
          <View className="flex-row items-center gap-2 px-4 py-3 border-b border-border">
            <Ionicons name="document-outline" size={16} color={theme.mutedForeground} />
            <Text className="text-sm font-medium text-foreground flex-1" numberOfLines={1}>
              {previewFile?.path ?? ""}
            </Text>
            {canEdit && previewFile ? (
              <Pressable
                onPress={() => {
                  const path = previewFile.path;
                  setPreviewPath(null);
                  setEditingFile(path);
                }}
                className="flex-row items-center gap-1 rounded-md border border-border px-2 py-1 active:bg-secondary"
                accessibilityLabel={t("skills.editor.editFile")}
              >
                <Ionicons name="create-outline" size={13} color={theme.mutedForeground} />
                <Text className="text-xs font-medium text-muted-foreground">
                  {t("skills.editor.editFile")}
                </Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => setPreviewPath(null)} accessibilityLabel={t("a11y.close")}>
              <Ionicons name="close" size={20} color={theme.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView className="flex-1 px-4 py-3" contentContainerClassName="pb-8">
            {isMarkdownPath(previewFile?.path ?? "") ? (
              <Markdown content={previewFile?.content ?? ""} />
            ) : (
              <Text className="text-xs text-foreground leading-5">
                {previewFile?.content ?? ""}
              </Text>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Rename sheet. A phone row cannot hold an editable path beside the
          tree, so the rename happens in a sheet instead of web's inline
          RenameRow; the validation is the same pure function either way, and
          it runs against every path except the one being replaced. */}
      <Modal
        visible={renameTarget !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setRenameTarget(null)}
      >
        <Pressable className="flex-1 bg-black/40" onPress={() => setRenameTarget(null)} />
        <View className="bg-background rounded-t-2xl overflow-hidden">
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
            <Text className="text-sm font-semibold text-foreground">
              {t("skills.detail.fileActions.rename")}
            </Text>
            <Pressable
              onPress={() => setRenameTarget(null)}
              accessibilityLabel={t("a11y.close")}
            >
              <Ionicons name="close" size={20} color={theme.mutedForeground} />
            </Pressable>
          </View>
          <View
            className="px-4 py-3 gap-2"
            style={{ paddingBottom: keyboardHeight + insets.bottom + 12 }}
          >
            <TextField
              autoFocus
              value={renameValue}
              onChangeText={(next) => {
                setRenameValue(next);
                setRenameError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              invalid={!!renameError}
              onSubmitEditing={submitRename}
            />
            {renameError ? (
              <Text className="text-xs text-destructive">
                {t(PATH_ERROR_KEY[renameError])}
              </Text>
            ) : null}
            <View className="flex-row items-center gap-2">
              <Button
                variant="outline"
                onPress={() => setRenameTarget(null)}
                className="flex-1"
              >
                <Text>{t("skills.detail.add_file.cancel")}</Text>
              </Button>
              <Button onPress={submitRename} className="flex-1">
                <Text>{t("skills.detail.fileActions.rename")}</Text>
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* Full-screen file editor (SKILL.md or an attached file). Mounted per
          open with key={editingFile} so baseline re-seeds on each path. */}
      {editingFile !== null ? (
        <SkillFileEditor
          key={editingFile}
          path={editingFile}
          skill={skill}
          files={files}
          onClose={() => setEditingFile(null)}
        />
      ) : null}
    {/* Labels picker sheet — attach/detach/inline-create skill labels.
          Mirrors the web ResourceLabelPicker (`resourceType="skill"`) exposed
          on a phone: search + checklist of the skill catalog, with inline
          create reacting to the typed query. */}
      <Modal
        visible={showLabels}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowLabels(false);
          setLabelsQuery("");
        }}
      >
        <Pressable
          className="flex-1 bg-black/40"
          onPress={() => {
            setShowLabels(false);
            setLabelsQuery("");
          }}
        />
        <View className="h-[75%] bg-background rounded-t-2xl overflow-hidden">
          <View className="flex-row items-center gap-2 px-4 py-3 border-b border-border">
            <Ionicons name="pricetags-outline" size={16} color={theme.mutedForeground} />
            <Text className="text-sm font-medium text-foreground flex-1">
              {t("skills.detail.labels")}
            </Text>
            <Pressable
              onPress={() => {
                setShowLabels(false);
                setLabelsQuery("");
              }}
              accessibilityLabel={t("a11y.close")}
            >
              <Ionicons name="close" size={20} color={theme.mutedForeground} />
            </Pressable>
          </View>
          <View className="px-4 py-2 border-b border-border">
            <TextInput
              value={labelsQuery}
              onChangeText={setLabelsQuery}
              placeholder={t("picker.searchLabels")}
              placeholderTextColor={theme.mutedForeground}
              className="border border-border rounded-md px-3 py-2 text-sm text-foreground"
              autoFocus
            />
          </View>
          <LabelPickerBody
            attached={skillLabels}
            query={labelsQuery}
            catalogResourceType="skill"
            onAttach={(label) => attachLabel.mutate(label.id)}
            onDetach={(labelId) => detachLabel.mutate(labelId)}
            onCreate={(name, color) => {
              // Create a skill-type label, attach it, and refresh the skill
              // catalog cache so the new label is offered next time.
              createLabel.mutate(
                { name, color, resource_type: "skill" },
                {
                  onSuccess: (label) => {
                    attachLabel.mutate(label.id);
                    if (wsId) {
                      void qc.invalidateQueries({
                        queryKey: labelKeys.catalog(wsId, "skill"),
                      });
                    }
                  },
                },
              );
            }}
          />
        </View>
      </Modal>

      {/* Add-to-agent multi-select sheet (web AddToAgentDialog parity):
          my agents first, then other agents (admin only), search across
          both groups; already-bound agents are filtered out. */}
      <MultiSelectSheet
        visible={addAgentsOpen}
        title={t("skills.usedBy.addTitle")}
        groups={addAgentGroups}
        searchPlaceholder={t("skills.usedBy.searchPlaceholder")}
        selectedKeys={agentSelection}
        emptyText={t("skills.usedBy.noAgents")}
        noMatchText={t("skills.usedBy.noMatch")}
        leading={(row) => <ActorAvatar type="agent" id={row.key} size={28} />}
        onToggle={(key) => {
          const next = new Set(agentSelection);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          setAgentSelection(next);
        }}
        onClose={() => {
          void confirmAddAgents();
        }}
      />
    </>
  );
}