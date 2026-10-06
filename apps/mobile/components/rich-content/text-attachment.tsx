/**
 * Inline preview for the text-backed attachment kinds — markdown and plain
 * text. Web reaches these through `ReadonlyContent` / `CodeBlockStatic` in
 * `AttachmentPreviewModal` (`packages/views/editor/attachment-preview-modal.tsx:840-880`).
 *
 * Why mobile renders them inline in the list instead of behind a preview
 * button: web's standalone list shows an `AttachmentCard` whose Eye button
 * opens that modal, and mobile has no modal framework (explicitly out of scope
 * this iteration). Without an inline render there is no way to read a `.md` or
 * `.txt` attachment on mobile at all — tapping downloads the file and hands it
 * to an external app. That is the divergence, and it is the useful direction on
 * a phone: the body is text, so it can simply be shown.
 *
 * Chrome mirrors `HtmlAttachmentPreview` (198) so the three text kinds behave
 * alike: filename row, a download button in the header, and — when the read
 * fails — the same download button *inside* the placeholder. Download never
 * depends on the preview having loaded, because on failure it is the only way
 * out (web's reasoning verbatim, `html-attachment-preview.tsx:100-103`).
 *
 * The three failure modes stay distinct: 413 (too large) and 415 (not text
 * previewable) are terminal and say why, with no retry — retrying re-sends the
 * same bytes to the same whitelist and fails identically. A transport failure
 * is retryable. Loading is its own state and never renders failure copy.
 */
import { useCallback } from "react";
import { Alert, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { Markdown } from "@/lib/markdown/markdown";
import { CodeBlock } from "@/lib/markdown/code-block";
import { resolveAttachmentUrl } from "@/lib/attachment-url";
import { attachmentLanguage } from "@/lib/rich-content/attachment-language";
import {
  textFailureKey,
  useAttachmentText,
} from "@/lib/rich-content/use-attachment-text";
import { downloadAttachmentAndOpen } from "@/lib/download-attachment";
import type { DownloadSource } from "@/lib/download-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useTranslation } from "@/lib/i18n/react";
import { THEME } from "@/lib/theme";

/** Caps a long body so one attachment cannot push the rest of the comment
 *  thread off screen. The body scrolls inside the cap. */
const BODY_MAX_HEIGHT_PX = 320;
const PLACEHOLDER_HEIGHT_PX = 64;

interface Props {
  attachmentId: string;
  filename: string;
  /** `download_url`, resolved against the API base here. Kept independent of
   *  the inline read so it still works when the read fails. */
  downloadUrl: string;
  /** Server-reported content type — the MIME hint for the system share sheet. */
  contentType: string;
  kind: "markdown" | "text";
  source?: DownloadSource;
}

export function TextAttachmentPreview({
  attachmentId,
  filename,
  downloadUrl,
  contentType,
  kind,
  source,
}: Props) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { t } = useTranslation();
  const { state, retry } = useAttachmentText(attachmentId);

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

  if (state.status === "loading") {
    return (
      <View
        className="bg-card border border-border rounded-lg justify-center px-3"
        style={{ minHeight: PLACEHOLDER_HEIGHT_PX }}
      >
        <Text className="text-xs text-muted-foreground">
          {t("richContent.attachment.previewLoading")}
        </Text>
      </View>
    );
  }

  if (state.status === "failed") {
    const isRetryable = state.reason === "failed";
    return (
      <View className="bg-card border border-border rounded-lg px-3 py-2">
        <View className="flex-row items-center gap-2">
          <Ionicons
            name={iconForKind(kind)}
            size={18}
            color={theme.mutedForeground}
          />
          <Text className="flex-1 text-sm text-muted-foreground" numberOfLines={1}>
            {filename}
          </Text>
        </View>
        <Text className="text-xs text-muted-foreground mt-1">
          {t(textFailureKey(state.reason))}
        </Text>
        <View className="flex-row gap-2 mt-2">
          {isRetryable ? (
            <ActionButton
              icon="refresh-outline"
              label={t("richContent.attachment.retry")}
              theme={theme}
              onPress={retry}
            />
          ) : null}
          <ActionButton
            icon="download-outline"
            label={t("richContent.attachment.download")}
            theme={theme}
            onPress={handleDownload}
          />
        </View>
      </View>
    );
  }

  return (
    <View className="bg-card border border-border rounded-lg overflow-hidden">
      <View className="flex-row items-center justify-between px-3 py-2">
        <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
          {filename}
        </Text>
        <Pressable
          onPress={handleDownload}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t("a11y.downloadFile", { filename })}
          className="rounded p-0.5 active:opacity-70"
        >
          <Ionicons name="download-outline" size={15} color={theme.mutedForeground} />
        </Pressable>
      </View>
      <View style={{ maxHeight: BODY_MAX_HEIGHT_PX }}>
        {kind === "markdown" ? (
          // `selectable={false}` opts out of UIKit text selection so a
          // long-press does not fight the surrounding comment's gestures.
          <View className="px-3 pb-3">
            <Markdown content={state.text} selectable={false} />
          </View>
        ) : (
          // Same renderer the fenced-code path uses, so a `.py` attachment and
          // a ```py fence are highlighted by one engine with one palette.
          // `attachmentLanguage` returns undefined for grammars we do not
          // bundle; `CodeBlock` then renders plain monospace.
          <CodeBlock code={state.text} lang={attachmentLanguage(filename)} />
        )}
      </View>
    </View>
  );
}

/** Markdown reads as prose, plain text as source. Mirrors the two web
 *  renderers so the placeholder icon hints at what was being loaded. */
function iconForKind(kind: "markdown" | "text"): keyof typeof Ionicons.glyphMap {
  return kind === "markdown" ? "document-text-outline" : "document-outline";
}

function ActionButton({
  icon,
  label,
  theme,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  theme: typeof THEME["light"];
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-row items-center gap-1 rounded-md border border-border px-2 py-1 active:opacity-80"
    >
      <Ionicons name={icon} size={14} color={theme.foreground} />
      <Text className="text-xs text-foreground">{label}</Text>
    </Pressable>
  );
}
