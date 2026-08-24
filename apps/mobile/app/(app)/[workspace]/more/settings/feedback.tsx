/**
 * Help & Feedback page (iteration-100) — aligns web HelpLauncher dropdown +
 * FeedbackModal as a push screen reached from Settings. Web's FeedbackModal
 * pairs a rich ContentEditor with draft-store + editor-upload; the mobile
 * equivalent deliberately substitutes a plain-text multiline input (RN has no
 * rich editor) and reuses the composer upload pipeline (`api.uploadFile`),
 * appending each uploaded attachment as a markdown image reference
 * `![name](markdown_url)` — exactly the serialization web's editor produces,
 * so the server-side `has_images` analytics flag behaves identically.
 *
 * Kind allow-list matches web `FEEDBACK_KINDS`; submissions go to
 * POST /api/feedback. Draft persists via SecureStore (mirrors web
 * draft-store `multica_feedback_draft`). The `url` field is the current
 * expo-router pathname (web sends window.location.href; mobile has no real
 * page URL, the route is the closest equivalent).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { Stack, router, usePathname } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { api, MAX_FILE_SIZE } from "@/data/api";
import { useCreateFeedback } from "@/data/mutations/feedback";
import { serverConfigOptions } from "@/data/queries/config";
import { FEEDBACK_KINDS, type FeedbackKind } from "@/data/schemas";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  clearFeedbackDraft,
  loadFeedbackDraft,
  saveFeedbackDraft,
} from "@/lib/feedback-draft";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";
import { cn } from "@/lib/utils";

const MAX_MESSAGE_LEN = 10000;

const DOCS_URL = "https://multica.ai/docs";
const CHANGELOG_URL = "https://multica.ai/changelog";
const DISCORD_URL = "https://discord.gg/W8gYBn226t";
const GITHUB_ISSUES_URL = "https://github.com/multica-ai/multica/issues";

interface FeedbackAttachment {
  localId: string;
  filename: string;
  status: "uploading" | "completed" | "failed";
  error?: string;
}

function makeLocalId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function FeedbackPage() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const pathname = usePathname();
  const mutation = useCreateFeedback();
  const { data: config } = useQuery(serverConfigOptions());
  const serverVersion = config?.server_version;

  const [kind, setKind] = useState<FeedbackKind>("general");
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<FeedbackAttachment[]>([]);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load any persisted draft on mount (web draft-store parity). Sweep the
  // debounce timer on unmount so a pending write never fires into React
  // after the page is gone.
  useEffect(() => {
    let alive = true;
    void loadFeedbackDraft().then((draft) => {
      if (alive && draft) setMessage(draft);
    });
    return () => {
      alive = false;
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, []);

  // Debounced draft persistence on every change — same storage key shape as
  // web's draft-store so a future shared storage migration stays trivial.
  const onMessageChange = useCallback((next: string) => {
    setMessage(next);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      void saveFeedbackDraft(next);
    }, 300);
  }, []);

  const hasInFlightUpload = attachments.some((a) => a.status === "uploading");
  const canSubmit =
    message.trim().length > 0 &&
    message.length <= MAX_MESSAGE_LEN &&
    !hasInFlightUpload &&
    !mutation.isPending;

  const uploadFile = useCallback(
    async (
      localId: string,
      asset: { uri: string; name: string; type: string },
    ) => {
      try {
        const result = await api.uploadFile(asset);
        setAttachments((prev) =>
          prev.map((it) =>
            it.localId === localId
              ? { ...it, status: "completed" as const }
              : it,
          ),
        );
        // Same markdown image reference web's ContentEditor inserts after an
        // upload — the message-only body carries it to POST /api/feedback.
        const mdUrl = result.markdown_url || result.url;
        const md = `![${result.filename}](${mdUrl})`;
        setMessage((prev) => (prev ? `${prev}\n${md}` : md));
      } catch (err) {
        setAttachments((prev) =>
          prev.map((it) =>
            it.localId === localId
              ? {
                  ...it,
                  status: "failed" as const,
                  error: err instanceof Error ? err.message : undefined,
                }
              : it,
          ),
        );
      }
    },
    [],
  );

  const onPickFile = useCallback(async () => {
    const picker = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
    });
    if (picker.canceled) return;
    const picked = picker.assets[0];
    if (!picked) return;
    if (picked.size != null && picked.size > MAX_FILE_SIZE) {
      Alert.alert(t("common.fileTooLarge"), t("common.fileTooLargeMessage"));
      return;
    }
    const mimeType = picked.mimeType ?? "application/octet-stream";
    const localId = makeLocalId();
    setAttachments((prev) => [
      ...prev,
      { localId, filename: picked.name, status: "uploading" },
    ]);
    void uploadFile(localId, {
      uri: picked.uri,
      name: picked.name,
      type: mimeType,
    });
  }, [t, uploadFile]);

  const onRemoveAttachment = useCallback((localId: string) => {
    setAttachments((prev) => prev.filter((it) => it.localId !== localId));
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed || canSubmit === false) return;
    if (message.length > MAX_MESSAGE_LEN) {
      Alert.alert(t("feedback.toastTooLong"));
      return;
    }
    try {
      await mutation.mutateAsync({
        message,
        kind,
        workspace_id: wsId ?? undefined,
        url: pathname,
      });
      await clearFeedbackDraft();
      Alert.alert(t("feedback.toastSent"), undefined, [
        { text: t("common.ok"), onPress: () => router.back() },
      ]);
    } catch (err) {
      // Keep the message + attachments intact so the user can retry.
      Alert.alert(
        t("feedback.toastFailed"),
        err instanceof Error && err.message
          ? err.message
          : t("feedback.toastFailed"),
      );
    }
  }, [message, kind, wsId, pathname, mutation, canSubmit, t]);

  const kindOptions: { value: FeedbackKind; labelKey: string }[] =
    FEEDBACK_KINDS.map((k) => ({
      value: k,
      labelKey:
        k === "bug"
          ? "feedback.kindBug"
          : k === "feature"
            ? "feedback.kindFeature"
            : k === "general"
              ? "feedback.kindGeneral"
              : "feedback.kindPraise",
    }));

  return (
    <>
      <Stack.Screen options={{ title: t("feedback.title") }} />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="px-4 py-4 gap-4"
      >
        {/* GitHub hint — same copy as web FeedbackModal header. */}
        <View className="flex-row flex-wrap items-center gap-1 px-1">
          <Text className="text-xs text-muted-foreground">
            {t("feedback.githubHintPrefix")}
          </Text>
          <Pressable
            onPress={() => void Linking.openURL(GITHUB_ISSUES_URL)}
            hitSlop={6}
            accessibilityRole="link"
          >
            <Text className="text-xs font-medium text-primary underline">
              {t("feedback.githubHintLink")}
            </Text>
          </Pressable>
        </View>

        {/* Kind picker — segmented, aligned with the ScopePicker pattern. */}
        <View className="rounded-md border border-border bg-card overflow-hidden">
          <View className="px-4 pt-3 pb-1">
            <Text className="text-[11px] font-medium text-muted-foreground">
              {t("feedback.kindLabel")}
            </Text>
          </View>
          <View className="flex-row flex-wrap px-3 pb-3 pt-1 gap-1.5">
            {kindOptions.map((opt) => {
              const active = kind === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setKind(opt.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-full border",
                    active ? "border-primary" : "border-border",
                  )}
                  style={
                    active
                      ? { backgroundColor: theme.primary + "1a" }
                      : undefined
                  }
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    className={cn(
                      "text-xs font-medium",
                      active ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {t(opt.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Message input — plain-text multiline (platform difference vs web's
            rich ContentEditor, see file header). */}
        <View className="rounded-md border border-border bg-card overflow-hidden">
          <TextInput
            value={message}
            onChangeText={onMessageChange}
            placeholder={t("feedback.placeholder")}
            placeholderTextColor={theme.mutedForeground}
            multiline
            maxLength={MAX_MESSAGE_LEN}
            className="px-4 py-3 text-base text-foreground"
            style={{ minHeight: 140, maxHeight: 220, textAlignVertical: "top" }}
          />
          <View className="flex-row items-center justify-between px-4 pb-2.5">
            <Text className="text-[11px] text-muted-foreground">
              {t("feedback.messageHint")}
            </Text>
            <Text
              className={cn(
                "text-[11px] tabular-nums",
                message.length > MAX_MESSAGE_LEN
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {message.length.toLocaleString()}
            </Text>
          </View>
        </View>

        {/* Attachments — upload once, referenced as inline images in the
            message (web-equivalent serialization). Failed uploads show the
            reason; remove lets the user discard the row (the appended
            `![…](url)` text stays in the message, editable by hand). */}
        <View className="rounded-md border border-border bg-card overflow-hidden">
          {attachments.length > 0 ? (
            <>
              {attachments.map((item) => (
                <AttachmentRow
                  key={item.localId}
                  item={item}
                  theme={theme}
                  onRemove={() => onRemoveAttachment(item.localId)}
                />
              ))}
              <Separator />
            </>
          ) : null}
          <Pressable
            onPress={onPickFile}
            disabled={hasInFlightUpload}
            className="flex-row items-center gap-2 px-4 py-3 active:bg-secondary"
            accessibilityRole="button"
            accessibilityState={{ disabled: hasInFlightUpload }}
          >
            {hasInFlightUpload ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : (
              <Ionicons name="attach-outline" size={18} color={theme.mutedForeground} />
            )}
            <Text className="flex-1 text-sm font-medium text-foreground">
              {hasInFlightUpload
                ? t("feedback.uploading")
                : t("feedback.attach")}
            </Text>
          </Pressable>
        </View>

        <Button disabled={!canSubmit} onPress={handleSubmit}>
          <Text>
            {mutation.isPending ? t("feedback.sending") : t("feedback.send")}
          </Text>
        </Button>

        {/* Resources — the HelpLauncher external links + server version. */}
        <View className="rounded-md border border-border bg-card overflow-hidden">
          <View className="px-4 pt-3 pb-1">
            <Text className="text-[11px] font-medium text-muted-foreground">
              {t("feedback.helpSectionLabel")}
            </Text>
          </View>
          <ExternalLinkRow
            icon="book-outline"
            label={t("feedback.helpDocs")}
            url={DOCS_URL}
          />
          <Separator />
          <ExternalLinkRow
            icon="time-outline"
            label={t("feedback.helpChangelog")}
            url={CHANGELOG_URL}
          />
          <Separator />
          <ExternalLinkRow
            icon="chatbubbles-outline"
            label={t("feedback.helpDiscord")}
            url={DISCORD_URL}
          />
          {serverVersion ? (
            <>
              <Separator />
              <View className="px-4 py-3">
                <Text className="text-[11px] text-muted-foreground">
                  {t("feedback.serverVersion", { version: serverVersion })}
                </Text>
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}

function AttachmentRow({
  item,
  theme,
  onRemove,
}: {
  item: FeedbackAttachment;
  theme: (typeof THEME)[keyof typeof THEME];
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center gap-2 px-4 py-2.5">
      <Ionicons
        name={
          item.status === "uploading"
            ? "cloud-upload-outline"
            : item.status === "failed"
              ? "alert-circle-outline"
              : "checkmark-circle-outline"
        }
        size={16}
        color={
          item.status === "failed"
            ? theme.destructive
            : item.status === "completed"
              ? theme.success
              : theme.mutedForeground
        }
      />
      <Text className="flex-1 text-xs text-foreground" numberOfLines={1}>
        {item.filename}
      </Text>
      {item.status === "failed" ? (
        <Text className="text-[11px] text-destructive" numberOfLines={1}>
          {t("feedback.uploadFailed")}
        </Text>
      ) : item.status === "uploading" ? (
        <ActivityIndicator size="small" color={theme.mutedForeground} />
      ) : null}
      <Pressable
        onPress={onRemove}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t("a11y.removeFile")}
      >
        <Ionicons name="close-circle" size={16} color={theme.mutedForeground} />
      </Pressable>
    </View>
  );
}

function ExternalLinkRow({
  icon,
  label,
  url,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  url: string;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      className="flex-row items-center gap-2 px-4 py-3 active:bg-secondary"
      accessibilityRole="link"
    >
      <Ionicons name={icon} size={18} color={theme.mutedForeground} />
      <Text className="flex-1 text-sm font-medium text-foreground">{label}</Text>
      <Ionicons
        name="open-outline"
        size={14}
        color={theme.mutedForeground}
      />
    </Pressable>
  );
}