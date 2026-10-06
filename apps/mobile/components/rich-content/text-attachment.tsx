/**
 * Inline preview for the text-backed attachment kinds — markdown and plain
 * text. Web reaches these through `ReadonlyContent` / `CodeBlockStatic` in
 * `AttachmentPreviewModal` (`packages/views/editor/attachment-preview-modal.tsx:840-880`).
 *
 * Why mobile renders them inline in the list instead of behind a preview
 * button: web's standalone list shows an `AttachmentCard` whose Eye button
 * opens that modal, and mobile has no hover to hang an Eye on. Without an
 * inline render there is no way to read a `.md` or `.txt` attachment on mobile
 * at all — tapping downloads the file and hands it to an external app. That is
 * the divergence, and it is the useful direction on a phone: the body is text,
 * so it can simply be shown.
 *
 * The cap is a list affordance, not a limit on reading. `BODY_MAX_HEIGHT_PX`
 * keeps one attachment from pushing the rest of a comment thread off screen,
 * and the "view fullscreen" row lifts it through the shared shell
 * (`lib/rich-content/fullscreen-preview`) — the same magnified view the html
 * fence block and the html attachment card use. Web reaches the identical
 * destination from its Eye button; here a long `.md` is readable without
 * leaving the app.
 *
 * Chrome mirrors `HtmlAttachmentPreview` (198) so the three text kinds behave
 * alike: filename row, a download button, and — when the read fails — the same
 * download button *inside* the placeholder. Download never depends on the
 * preview having loaded, because on failure it is the only way out (web's
 * reasoning verbatim, `html-attachment-preview.tsx:100-103`).
 *
 * The fullscreen entry deliberately does NOT appear in the loading or failed
 * branches: there is no body to magnify, and a button that opens an empty
 * modal claims a capability this state does not have. Guarded by
 * `lib/attachment-action-parity.test.ts`.
 *
 * The three failure modes stay distinct: 413 (too large) and 415 (not text
 * previewable) are terminal and say why, with no retry — retrying re-sends the
 * same bytes to the same whitelist and fails identically. A transport failure
 * is retryable. Loading is its own state and never renders failure copy.
 */
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
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
import { FullscreenPreview } from "@/lib/rich-content/fullscreen-preview";
import { downloadAttachmentAndOpen } from "@/lib/download-attachment";
import type { DownloadSource } from "@/lib/download-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useTranslation } from "@/lib/i18n/react";
import { THEME } from "@/lib/theme";

/** Caps a long body so one attachment cannot push the rest of the comment
 *  thread off screen. The body scrolls inside the cap, and the fullscreen row
 *  below lifts the cap. */
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
  const [fullscreen, setFullscreen] = useState(false);

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

  // `state.status === "ready"` from here: the body exists, so the fullscreen
  // entry exists. Everything above returned before this point on purpose.
  //
  // Padding belongs to the container, not the body: the inline card and the
  // fullscreen scroll view inset it differently, and baking one of them into
  // the shared node would double it up in the other.
  const body =
    kind === "markdown" ? (
      // `selectable={false}` opts out of UIKit text selection so a
      // long-press does not fight the surrounding comment's gestures.
      <Markdown content={state.text} selectable={false} />
    ) : (
      // Same renderer the fenced-code path uses, so a `.py` attachment and
      // a ```py fence are highlighted by one engine with one palette.
      // `attachmentLanguage` returns undefined for grammars we do not
      // bundle; `CodeBlock` then renders plain monospace.
      <CodeBlock code={state.text} lang={attachmentLanguage(filename)} />
    );

  return (
    <>
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
        {/* Capped, not clipped: the body keeps scrolling inside the cap rather
            than being cut off mid-paragraph with no way to reach the rest. */}
        <ScrollView
          style={{ maxHeight: BODY_MAX_HEIGHT_PX }}
          contentContainerClassName="px-3 pb-3"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          {body}
        </ScrollView>
        <Pressable
          onPress={() => setFullscreen(true)}
          hitSlop={6}
          className="border-t border-border px-3 py-1.5"
          accessibilityRole="button"
          accessibilityLabel={t("richContent.html.viewFullscreen")}
        >
          <Text className="text-xs text-foreground">
            {t("richContent.html.viewFullscreen")}
          </Text>
        </Pressable>
      </View>
      <FullscreenPreview
        visible={fullscreen}
        onClose={() => setFullscreen(false)}
        title={filename}
      >
        {/* The body scrolls here as page content, which is the point: the
            inline cap no longer applies and the reader can go end to end. */}
        <ScrollView
          className="flex-1 px-4 py-3"
          contentContainerClassName="pb-8"
        >
          {body}
        </ScrollView>
      </FullscreenPreview>
    </>
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
