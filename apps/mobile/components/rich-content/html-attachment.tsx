/**
 * HTML attachment inline preview (comment cards / issue attachment lists) —
 * the mobile twin of web's `HtmlAttachmentPreview`
 * (packages/views/editor/html-attachment-preview.tsx).
 *
 * The body loads through `GET /api/attachments/{id}/content` (server-side
 * text/HTML proxy, 2 MB cap + content-type whitelist — 413/415 are hard
 * failures, never retried). Rendering uses the same sandbox document as the
 * ```html fence block (buildHtmlPreviewDocument) with `javaScriptEnabled
 * ={false}` — strictly more restrictive than web's sandbox="allow-scripts"
 * iframe. Preview / source tabs mirror the fence block's interaction.
 *
 * Actions (web parity): web's toolbar carries Download next to Preview, and
 * pins itself open on failure because "Preview / Download are the only
 * user-reachable escape hatches when inline render fails"
 * (html-attachment-preview.tsx:100-103). Mobile has no hover, so the
 * equivalent is to put the actions in the card itself — in the header when the
 * preview rendered, and inside the placeholder when it did not. Either way an
 * HTML attachment always has a way out: download never depends on the preview
 * having loaded.
 *
 * Failure states are distinct on purpose. A transport failure is retryable and
 * says so (`richContent.html.loadFailed` — "use download"), while 413/415 are
 * terminal and name the reason. Loading is its own state: `text === null` before
 * the first response settles is NOT "preview unavailable", and rendering the
 * failure placeholder there claimed an absence out of an unsettled read.
 */
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { WebView } from "react-native-webview";
import { Text } from "@/components/ui/text";
import {
  api,
  PreviewTooLargeError,
  PreviewUnsupportedError,
} from "@/data/api";
import { resolveAttachmentUrl } from "@/lib/attachment-url";
import { downloadAttachmentAndOpen } from "@/lib/download-attachment";
import type { DownloadSource } from "@/lib/download-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useTranslation } from "@/lib/i18n/react";
import { CodeBlock } from "@/lib/markdown/code-block";
import { buildHtmlPreviewDocument } from "@/lib/rich-content/html-preview-doc";
import { THEME } from "@/lib/theme";

const PREVIEW_HEIGHT_PX = 300;
const ERROR_HEIGHT_PX = 80;

interface Props {
  attachmentId: string;
  filename: string;
  /** The attachment's `download_url`, resolved against the API base here.
   *  Download must stay independent of the inline preview: it is the escape
   *  hatch when rendering fails, so it cannot be gated on a successful load. */
  downloadUrl: string;
  /** Server-reported content type — the MIME hint handed to the system share
   *  sheet once the file is on disk. */
  contentType: string;
  /** Where this attachment lives, recorded into the download manager. */
  source?: DownloadSource;
}

export function HtmlAttachmentPreview({
  attachmentId,
  filename,
  downloadUrl,
  contentType,
  source,
}: Props) {
  const { isDarkColorScheme } = useColorScheme();
  const { t } = useTranslation();
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState<null | "tooLarge" | "unsupported" | "failed">(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const res = await api.getAttachmentTextContent(attachmentId);
      setText(res.text);
    } catch (err) {
      if (err instanceof PreviewTooLargeError) setFailed("tooLarge");
      else if (err instanceof PreviewUnsupportedError) setFailed("unsupported");
      else setFailed("failed");
    }
  }, [attachmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDownload = useCallback(() => {
    // Same authenticated in-app path as the file card (MYS-270): the raw
    // `download_url` may be server-relative or a short-lived signed URL, and
    // the request must carry the session Bearer header.
    const target = resolveAttachmentUrl(downloadUrl);
    if (!target) return;
    void downloadAttachmentAndOpen(target, filename, contentType, source).catch(
      () => {
        Alert.alert(t("download.failedTitle"), t("download.failedMessage"));
      },
    );
  }, [contentType, downloadUrl, filename, source, t]);

  if (failed) {
    // Error placeholder — the collapsed card keeps the surface stable and the
    // filename visible, and carries the two escape hatches itself (retry when
    // the failure is retryable, download always). Mirrors web's pinned-toolbar
    // failure mode without needing hover.
    const isRetryable = failed === "failed";
    const messageKey =
      failed === "tooLarge"
        ? "richContent.html.tooLarge"
        : failed === "unsupported"
          ? "richContent.html.unsupported"
          : "richContent.html.loadFailed";
    return (
      <View className="bg-card border border-border rounded-lg px-3 py-2" style={{ minHeight: ERROR_HEIGHT_PX }}>
        <View className="flex-row items-center gap-2">
          <Ionicons name="document-outline" size={18} color={THEME[isDarkColorScheme ? "dark" : "light"].mutedForeground} />
          <Text className="flex-1 text-sm text-muted-foreground" numberOfLines={1}>
            {filename}
          </Text>
        </View>
        <Text className="text-xs text-muted-foreground mt-1">{t(messageKey)}</Text>
        <View className="flex-row gap-2 mt-2">
          {isRetryable ? (
            <ActionButton
              icon="refresh-outline"
              label={t("richContent.html.retry")}
              onPress={() => void load()}
            />
          ) : null}
          <ActionButton
            icon="download-outline"
            label={t("richContent.html.download")}
            onPress={handleDownload}
          />
        </View>
      </View>
    );
  }

  if (text === null) {
    // First response has not settled. Deliberately NOT the failure copy — an
    // in-flight read is not an unavailable preview.
    return (
      <View
        className="bg-card border border-border rounded-lg justify-center px-3"
        style={{ height: ERROR_HEIGHT_PX }}
      >
        <Text className="text-xs text-muted-foreground">
          {t("richContent.html.previewLoading")}
        </Text>
      </View>
    );
  }

  const doc = buildHtmlPreviewDocument(text);

  return (
    <View className="bg-card border border-border rounded-lg overflow-hidden">
      <View className="flex-row items-center justify-between px-3 py-2">
        <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
          {filename}
        </Text>
        <View className="flex-row items-center gap-1">
          <TabButton
            label={t("richContent.html.preview")}
            active={mode === "preview"}
            onPress={() => setMode("preview")}
          />
          <TabButton
            label={t("richContent.html.source")}
            active={mode === "source"}
            onPress={() => setMode("source")}
          />
          <IconButton
            icon="download-outline"
            accessibilityLabel={t("a11y.downloadFile", { filename })}
            onPress={handleDownload}
          />
        </View>
      </View>
      {mode === "preview" ? (
        <View style={{ height: PREVIEW_HEIGHT_PX }}>
          <WebView
            key={text}
            source={{ html: doc }}
            style={{
              flex: 1,
              backgroundColor: isDarkColorScheme ? "#1f2937" : "#ffffff",
            }}
            javaScriptEnabled={false}
            domStorageEnabled={false}
            setSupportMultipleWindows={false}
            originWhitelist={["*"]}
            overScrollMode="never"
          />
        </View>
      ) : (
        <View className="px-3 pb-2">
          <CodeBlock code={text} lang="html" />
        </View>
      )}
    </View>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      className={`rounded px-2 py-0.5 ${active ? "bg-muted" : ""}`}
      accessibilityRole="button"
    >
      <Text
        className={`text-xs ${active ? "text-foreground" : "text-muted-foreground"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function IconButton({
  icon,
  accessibilityLabel,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="rounded p-0.5 active:opacity-70"
    >
      <Ionicons name={icon} size={15} color={THEME[colorScheme].mutedForeground} />
    </Pressable>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-row items-center gap-1 rounded-md border border-border px-2 py-1 active:opacity-80"
    >
      <Ionicons name={icon} size={14} color={THEME[colorScheme].foreground} />
      <Text className="text-xs text-foreground">{label}</Text>
    </Pressable>
  );
}
