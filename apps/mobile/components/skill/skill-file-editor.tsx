/**
 * Skill file editor — full-screen modal for viewing/editing a single skill
 * file (SKILL.md or an attached file), mirroring web
 * `packages/views/skills/components/file-viewer.tsx` + the detail page's
 * save/discard/conflict model on a phone.
 *
 * Interaction model (web parity):
 *   - preview/raw is a property of how the user wants to work, not of the
 *     file; only markdown files offer preview. Frontmatter is stripped from
 *     the preview (name/description are first-class fields on the detail page
 *     already); everything else renders raw.
 *   - Opening the editor snapshots the file into `baseline`; dirty = current
 *     text ≠ baseline.
 *   - Save PUTs the WHOLE skill (name/description/content/files): the edited
 *     file carries the new text and every untouched file is echoed back
 *     verbatim, because the server replaces the file set wholesale
 *     (skill.go UpdateSkill: files != nil ⇒ delete + upsert all). Discard
 *     reverts to baseline and closes.
 *   - Conflict guard (minimal MUL-5645): if the server version
 *     (`skill.updated_at`) moved on past the version the editor opened with,
 *     Save asks whether to adopt the server version or overwrite it.
 *
 * The parent conditionally mounts this modal with `key={path}`, so each open
 * is a fresh mount: baseline seeding needs no visible/visibility churn.
 */
import { useEffect, useState } from "react";
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
import Ionicons from "@expo/vector-icons/Ionicons";
import { parseFrontmatter } from "@multica/core/skills/frontmatter";
import type { Skill, UpdateSkillRequest } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useUpdateSkill } from "@/data/mutations/skills";
import { skillKeys } from "@/data/queries/skills";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { Markdown } from "@/lib/markdown";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SKILL_MD = "SKILL.md";

export function isSkillMdPath(path: string): boolean {
  return path === SKILL_MD;
}

function isMarkdownPath(path: string): boolean {
  return path.endsWith(".md") || path.endsWith(".mdx");
}

type EditorMode = "preview" | "raw";

function currentContent(skill: Skill | null, path: string): string {
  if (!skill) return "";
  if (isSkillMdPath(path)) return skill.content ?? "";
  return skill.files?.find((f) => f.path === path)?.content ?? "";
}

/** Frontmatter is stripped from the preview (web file-viewer parity). */
function previewBody(path: string, text: string): string {
  if (!isMarkdownPath(path)) return text;
  return parseFrontmatter(text).body;
}

export function SkillFileEditor({
  path,
  skill,
  onClose,
}: {
  path: string;
  /** Current server skill (latest query data) — source of baseline + conflict
   *  version + untouched files for the wholesale save. */
  skill: Skill | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const insets = useSafeAreaInsets();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const qc = useQueryClient();
  const updateSkill = useUpdateSkill();

  const [text, setText] = useState(() => currentContent(skill, path));
  const [mode, setMode] = useState<EditorMode>("preview");
  // The content + server updated_at the editor opened with. Only the mount
  // snapshot counts; the parent remounts the modal per path via key.
  const [baseline] = useState(() => currentContent(skill, path));
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [openedUpdatedAt, setOpenedUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    setOpenedUpdatedAt(skill?.updated_at ?? null);
    // KeyboardAvoidingView does not reliably lift content inside an RN Modal
    // on Android (no window resize), so the footer is lifted manually.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!skill) return null;

  const isPrimary = isSkillMdPath(path);
  const isMd = isMarkdownPath(path);
  const dirty = text !== baseline;
  const body = previewBody(path, text);
  const saving = updateSkill.isPending;

  const handleDiscard = () => {
    setText(baseline);
    onClose();
  };

  const saveWithText = async (next: string) => {
    const payload: UpdateSkillRequest = {
      name: skill.name,
      description: skill.description,
      content: isPrimary ? next : skill.content,
      files: (skill.files ?? []).map((f) => ({
        path: f.path,
        content: !isPrimary && f.path === path ? next : f.content,
      })),
    };
    try {
      const updated = await updateSkill.mutateAsync({ id: skill.id, ...payload });
      if (updated.id && wsId) {
        qc.setQueryData<Skill>(skillKeys.detail(wsId, skill.id), updated);
      }
      onClose();
    } catch (err) {
      Alert.alert(
        t("skills.editor.saveFailed"),
        err instanceof Error ? err.message : t("common.unknownError"),
      );
    }
  };

  const handleSave = () => {
    if (!dirty || saving) return;
    const serverMoved =
      openedUpdatedAt !== null && skill.updated_at !== openedUpdatedAt;
    if (!serverMoved) {
      void saveWithText(text);
      return;
    }
    Alert.alert(
      t("skills.editor.conflictServerUpdated"),
      t("skills.editor.conflictBody"),
      [
        {
          text: t("skills.editor.conflictUseServer"),
          style: "cancel",
          onPress: () => {
            // Adopt the server's version: drop local edits and close.
            const serverContent = currentContent(skill, path);
            setText(serverContent);
            onClose();
          },
        },
        {
          text: t("skills.editor.conflictOverwrite"),
          style: "destructive",
          onPress: () => void saveWithText(text),
        },
      ],
    );
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={handleDiscard}>
      <View
        className="flex-1 bg-background"
        // Full-screen modal draws under the status bar on Android; pad the
        // header down below it so the mode toggle stays tappable.
        style={{ paddingTop: insets.top }}
      >
        {/* Header: path + mode toggle + close */}
        <View className="flex-row items-center gap-2 px-4 py-3 border-b border-border">
          <Ionicons
            name={isPrimary ? "document-text-outline" : "document-outline"}
            size={16}
            color={theme.mutedForeground}
          />
          <Text className="text-sm font-medium text-foreground flex-1" numberOfLines={1}>
            {path}
          </Text>
          {isMd ? (
            <View className="flex-row items-center rounded-md bg-secondary p-0.5">
              {(["preview", "raw"] as const).map((value) => (
                <Pressable
                  key={value}
                  onPress={() => setMode(value)}
                  className={`px-2.5 py-1 rounded ${
                    mode === value ? "bg-card" : ""
                  }`}
                >
                  <Text
                    className={`text-xs font-medium ${
                      mode === value ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {t(
                      value === "preview"
                        ? "skills.editor.preview"
                        : "skills.editor.raw",
                    )}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Pressable onPress={handleDiscard} accessibilityLabel={t("a11y.close")}>
            <Ionicons name="close" size={20} color={theme.mutedForeground} />
          </Pressable>
        </View>

        {/* Body */}
        {isMd && mode === "preview" ? (
          <ScrollView className="flex-1 px-4 py-3" contentContainerClassName="pb-8">
            {body?.trim() ? (
              <Markdown content={body} />
            ) : (
              <Text className="text-xs text-muted-foreground/70 italic">
                {t("skills.editor.noContent")}
              </Text>
            )}
          </ScrollView>
        ) : (
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            editable={!saving}
            placeholder={t(
              isPrimary
                ? "skills.editor.markdownPlaceholder"
                : "skills.editor.rawPlaceholder",
            )}
            placeholderTextColor={theme.mutedForeground}
            className="flex-1 px-4 py-3 text-sm text-foreground font-mono leading-6"
            textAlignVertical="top"
            autoFocus={mode === "raw"}
            style={{ includeFontPadding: false }}
          />
        )}

        {/* Footer: dirty status + Discard / Save */}
        <View
          className="border-t border-border px-4 py-3 gap-2"
          style={{ paddingBottom: keyboardHeight + insets.bottom }}
        >
          {dirty ? (
            <Text className="text-xs text-muted-foreground">
              {t("skills.editor.dirty")}
            </Text>
          ) : null}
          <View className="flex-row items-center gap-2">
            <Button
              variant="outline"
              onPress={handleDiscard}
              disabled={saving}
              className="flex-1"
            >
              <Text>{t("skills.editor.discard")}</Text>
            </Button>
            <Button onPress={handleSave} disabled={!dirty || saving} className="flex-1">
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text>{t("skills.editor.save")}</Text>
              )}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}