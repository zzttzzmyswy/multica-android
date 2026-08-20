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
 *                      Markdown renderer, everything else → monospace text)
 *
 * Management gate mirrors `canEditSkill` (lib/skill-guards.ts + web
 * use-can-edit-skill): workspace owner/admin manage every skill; a regular
 * member manages only skills they created. When editable, an edit button
 * opens a bottom sheet with the shared SkillForm (rename/describe/delete,
 * delete double-confirmed). Otherwise the edit affordance is hidden entirely
 * — the server remains the authoritative gate.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Label, SkillFile } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { SkillForm } from "@/components/skill/skill-form";
import { SkillFileEditor } from "@/components/skill/skill-file-editor";
import { SkillFileTree } from "@/components/skill/skill-file-tree";
import { LabelPickerBody } from "@/components/issue/pickers/label-picker-body";
import { skillDetailOptions } from "@/data/queries/skills";
import { memberListOptions } from "@/data/queries/members";
import { labelKeys, resourceLabelsOptions } from "@/data/queries/labels";
import {
  useAttachResourceLabel,
  useCreateLabel,
  useDetachResourceLabel,
} from "@/data/mutations/labels";
import { useRefreshSkill } from "@/data/mutations/skills";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import {
  canEditSkill,
  isRefreshableOrigin,
  ORIGIN_LABEL_KEY,
  readOrigin,
} from "@/lib/skill-guards";
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
  const [previewFile, setPreviewFile] = useState<SkillFile | null>(null);
  // Path of the file currently open in the full-screen editor (SKILL.md or an
  // attached file); null = closed. The editor modal is conditionally mounted
  // with key={editingFile} so each open re-seeds from the latest server skill.
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [labelsQuery, setLabelsQuery] = useState("");
  const qc = useQueryClient();
  const attachLabel = useAttachResourceLabel("skill", id);
  const detachLabel = useDetachResourceLabel("skill", id);
  const createLabel = useCreateLabel();
  const refreshSkill = useRefreshSkill();

  const skill = data;
  const canEdit = canEditSkill(skill, { userId, role });
  const creatorName = useMemo(() => {
    if (!skill?.created_by) return null;
    return members.find((m) => m.user_id === skill.created_by)?.name ?? null;
  }, [skill?.created_by, members]);

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

  const origin = readOrigin(skill);
  const files = skill.files ?? [];
  const refreshable = canEdit && isRefreshableOrigin(origin);

  /** Common open entry: SKILL.md opens straight in the editor (its read view
   *  is the SKILL.md card above), other files open the preview sheet, whose
   *  edit affordance hands them to the same editor. */
  const openFile = (path: string) => {
    if (path === "SKILL.md") {
      setEditingFile("SKILL.md");
    } else {
      setPreviewFile(files.find((f) => f.path === path) ?? null);
    }
  };

  const handleRefresh = () => {
    if (!skill || refreshSkill.isPending) return;
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

  return (
    <>
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="pb-10"
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
                    {t(ORIGIN_LABEL_KEY[origin.type])}
                  </Text>
                </View>
              </View>
              {skill.description ? (
                <Text className="text-sm text-muted-foreground/80">
                  {skill.description}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Meta rows */}
          <View className="mt-4 rounded-lg border border-border divide-y divide-border">
            <View className="px-3 py-1">
              <MetaRow
                icon="layers-outline"
                label={t("skills.detail.origin")}
                value={t(ORIGIN_LABEL_KEY[origin.type])}
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
          <SectionTitle icon="folder-open-outline" title={t("skills.detail.files")} />
          {files.length === 0 ? (
            <View className="rounded-lg border border-dashed border-border px-3 py-6 items-center">
              <Text className="text-xs text-muted-foreground/70 italic">
                {t("skills.detail.noFiles")}
              </Text>
            </View>
          ) : (
            <SkillFileTree
              paths={["SKILL.md", ...files.map((f) => f.path)]}
              selectedPath={editingFile ?? previewFile?.path ?? ""}
              onSelect={openFile}
            />
          )}
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
        onRequestClose={() => setPreviewFile(null)}
      >
        <Pressable className="flex-1 bg-black/40" onPress={() => setPreviewFile(null)} />
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
                  setPreviewFile(null);
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
            <Pressable onPress={() => setPreviewFile(null)} accessibilityLabel={t("a11y.close")}>
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

      {/* Full-screen file editor (SKILL.md or an attached file). Mounted per
          open with key={editingFile} so baseline re-seeds on each path. */}
      {editingFile !== null ? (
        <SkillFileEditor
          key={editingFile}
          path={editingFile}
          skill={skill}
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
    </>
  );
}