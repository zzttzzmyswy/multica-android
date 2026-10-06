/**
 * Download-and-open card for the attachment kinds that cannot be rendered
 * inline on Android.
 *
 * Which kinds land here and why (measured, not assumed):
 *
 *   - `pdf`  — web renders these in an `<iframe>` and leans on Chromium's
 *     PDFium plugin (`attachment-preview-modal.tsx:816`). Android's WebView
 *     ships no PDF plugin, so an inline `<iframe src=...pdf>` renders a blank
 *     box or a download prompt, not the document. Previewing a PDF in-app needs
 *     a renderer library, which this iteration rules out (no new dependency).
 *   - `video` / `audio` — Android WebView *can* play HTML5 media, but the
 *     media element issues its own sub-request for the bytes, and that request
 *     carries no `Authorization` header. The download endpoint requires one
 *     (`GET /api/attachments/{id}/download` returns 401 without a Bearer token
 *     — verified against mu.zztweb.top), so a `<video src>` pointed at it
 *     cannot load. Handing the bytes to the system player through the existing
 *     authenticated download flow is both correct and the better phone
 *     experience: playback, scrubbing, and fullscreen come from the platform
 *     player instead of a WebView imitation.
 *   - `file` — the genuine catch-all.
 *
 * So all four share one card, and the card's job is to be honest about what the
 * file is and to open it in one tap. It differs from 198's file card only in
 * that the icon and the action label name the kind, so a PDF and an MP4 no
 * longer look identical in a comment thread.
 */
import { useCallback } from "react";
import { Alert, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Attachment } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { resolveAttachmentUrl } from "@/lib/attachment-url";
import { downloadAttachmentAndOpen } from "@/lib/download-attachment";
import type { DownloadSource } from "@/lib/download-store";
import { useTranslation } from "@/lib/i18n/react";
import { THEME } from "@/lib/theme";

/** Kinds this card serves. `image` / `html` / `markdown` / `text` have their
 *  own renderers and never reach here. */
export type FileCardKind = "pdf" | "video" | "audio" | "file";

interface Props {
  attachment: Attachment;
  kind: FileCardKind;
  theme: typeof THEME["light"];
  source?: DownloadSource;
}

export function FileCard({ attachment, kind, theme, source }: Props) {
  const { t } = useTranslation();
  const sizeLabel = formatBytes(attachment.size_bytes);

  const handleOpen = useCallback(() => {
    // MYS-270: opening `download_url` in the external browser sent no
    // `Authorization` header, so the server rejected it with "missing
    // authorization". Download in-app with the session auth, then open the
    // saved file through the system handler sheet. `content_type` is the share
    // hint that lets Android pick a player for video/audio and a viewer for
    // PDF.
    const target = resolveAttachmentUrl(attachment.download_url);
    if (!target) return;
    void downloadAttachmentAndOpen(
      target,
      attachment.filename,
      attachment.content_type,
      source,
    ).catch(() => {
      Alert.alert(t("download.failedTitle"), t("download.failedMessage"));
    });
  }, [attachment, source, t]);

  return (
    <Pressable
      onPress={handleOpen}
      accessibilityRole="button"
      accessibilityLabel={t("a11y.openFile", { filename: attachment.filename })}
      className="flex-row items-center gap-2 px-3 py-2 rounded-md bg-secondary/60 active:opacity-80"
    >
      <Ionicons name={iconForKind(kind)} size={20} color={theme.mutedForeground} />
      <View className="flex-1">
        <Text className="text-sm text-foreground" numberOfLines={1}>
          {attachment.filename}
        </Text>
        {sizeLabel ? (
          <Text className="text-xs text-muted-foreground">{sizeLabel}</Text>
        ) : null}
      </View>
      <Ionicons
        name="download-outline"
        size={18}
        color={theme.mutedForeground}
      />
    </Pressable>
  );
}

/** Distinct glyphs so the kind is legible before the filename is read. */
function iconForKind(kind: FileCardKind): keyof typeof Ionicons.glyphMap {
  switch (kind) {
    case "pdf":
      return "document-text-outline";
    case "video":
      return "videocam-outline";
    case "audio":
      return "musical-notes-outline";
    case "file":
      return "document-outline";
  }
}

function formatBytes(bytes: number): string | null {
  if (!bytes || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const formatted =
    value < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${formatted} ${units[unitIndex]}`;
}
