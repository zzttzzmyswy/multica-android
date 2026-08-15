/**
 * Standalone attachment list for comment cards.
 *
 * Mirrors the design of web's `AttachmentList` in
 * `packages/views/issues/components/comment-card.tsx:121-159` — renders
 * any attachment whose URL the markdown content didn't already reference,
 * with same-file dedup so a duplicate upload referenced inline doesn't
 * also appear below.
 *
 * The data-contract parity goal: a comment authored on mobile (which has
 * no inline-insert path — see `inline-comment-composer.tsx`) carries its
 * attachments via the `attachments` field only, with no `![](url)` in
 * `content`. Web reads it back and `AttachmentList` puts the attachments
 * below the body. Mobile reads it back here and does the same. A comment
 * authored on web with inline images already inside the markdown renders
 * inline on both clients via `MarkdownImage`, and this list returns null
 * because there's nothing "leftover" to show.
 *
 * For v1 we render images via the same `MarkdownImage` used by inline
 * markdown rendering (consistent aspect-ratio + lightbox behavior). Non-
 * image attachments render as a tappable file card showing 📎 + filename
 * + size hint, opening the canonical download URL on tap.
 */
import { useMemo } from "react";
import { Alert, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Attachment } from "@multica/core/types";
import { standaloneAttachments } from "@/lib/attachment-dedup";
import { MarkdownImage } from "@/lib/markdown/markdown-image";
import { resolveAttachmentUrl } from "@/lib/attachment-url";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { downloadAttachmentAndOpen } from "@/lib/download-attachment";

interface Props {
  attachments?: Attachment[];
  /** The comment's markdown content. Attachments referenced inside it via
   *  `![](url)` or `[name](url)` are skipped so they aren't double-rendered.
   *  Pass `undefined` (not just an empty string) when the comment has no
   *  body — that disables the inline-reference filter and renders all
   *  supplied attachments. */
  content?: string;
}

export function CommentAttachmentList({ attachments, content }: Props) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  // Only render attachments not already referenced inline in the body. The
  // dedup lives in a pure helper (lib/attachment-dedup) so it can be unit
  // tested; it matches every real URL form the server emits (stable path /
  // url / download_url / markdown_url), mirroring web's AttachmentList.
  const standalone = useMemo(
    () => standaloneAttachments(attachments, content),
    [attachments, content],
  );

  if (standalone.length === 0) return null;

  return (
    <View className="gap-1.5">
      {standalone.map((attachment) => {
        const isImage = attachment.content_type.startsWith("image/");
        if (isImage) {
          return (
            <MarkdownImage
              key={attachment.id}
              uri={attachment.url}
              alt={attachment.filename}
              attachments={attachments}
            />
          );
        }
        return (
          <FileCard
            key={attachment.id}
            attachment={attachment}
            theme={theme}
          />
        );
      })}
    </View>
  );
}

function FileCard({
  attachment,
  theme,
}: {
  attachment: Attachment;
  theme: typeof THEME["light"];
}) {
  const sizeLabel = formatBytes(attachment.size_bytes);
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={() => {
        // MYS-270: opening `download_url` in the external browser sent no
        // `Authorization` header, so the server rejected it with "missing
        // authorization". Download in-app with the session auth (the request
        // carries the Bearer header), then open the saved file via the system
        // handler sheet. `content_type` from the server is the share hint; an
        // absolute CloudFront URL was already usable via `Linking`, but going
        // through our authenticated path keeps every storage mode working.
        const target = resolveAttachmentUrl(attachment.download_url);
        if (!target) return;
        void downloadAttachmentAndOpen(
          target,
          attachment.filename,
          attachment.content_type,
        ).catch(() => {
          Alert.alert(t("download.failedTitle"), t("download.failedMessage"));
        });
      }}
      accessibilityRole="button"
      accessibilityLabel={`Open ${attachment.filename}`}
      className="flex-row items-center gap-2 px-3 py-2 rounded-md bg-secondary/60 active:opacity-80"
    >
      <Ionicons
        name="document-outline"
        size={20}
        color={theme.mutedForeground}
      />
      <View className="flex-1">
        <Text
          className="text-sm text-foreground"
          numberOfLines={1}
        >
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
