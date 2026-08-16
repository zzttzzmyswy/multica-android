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
  Modal,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { SkillFile } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { SkillForm } from "@/components/skill/skill-form";
import { skillDetailOptions } from "@/data/queries/skills";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { canEditSkill, ORIGIN_LABEL_KEY, readOrigin } from "@/lib/skill-guards";
import { useSkillRole } from "@/lib/use-skill-role";
import { useTimeAgo } from "@/lib/time-ago";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { Markdown } from "@/lib/markdown";

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

export default function SkillDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const role = useSkillRole(wsId);
  const timeAgo = useTimeAgo();

  const { data, isLoading, error, refetch } = useQuery(skillDetailOptions(wsId, id));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const [editing, setEditing] = useState(false);
  const [previewFile, setPreviewFile] = useState<SkillFile | null>(null);

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
          </View>
        </View>

        {/* SKILL.md */}
        <View className="mt-6 px-4 gap-2">
          <SectionTitle icon="document-text-outline" title={t("skills.detail.readme")} />
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
            <View className="rounded-lg border border-border divide-y divide-border">
              {files.map((file) => (
                <Pressable
                  key={file.id}
                  onPress={() => setPreviewFile(file)}
                  className="flex-row items-center gap-2 px-3 py-3 active:bg-secondary"
                  accessibilityLabel={file.path}
                >
                  <Ionicons name="document-outline" size={16} color={theme.mutedForeground} />
                  <Text
                    className="text-sm text-foreground flex-1"
                    numberOfLines={1}
                  >
                    {file.path}
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
                </Pressable>
              ))}
            </View>
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
        <View className="h-[75%] bg-background rounded-t-2xl overflow-hidden">
          <View className="flex-row items-center gap-2 px-4 py-3 border-b border-border">
            <Ionicons name="document-outline" size={16} color={theme.mutedForeground} />
            <Text className="text-sm font-medium text-foreground flex-1" numberOfLines={1}>
              {previewFile?.path ?? ""}
            </Text>
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
    </>
  );
}