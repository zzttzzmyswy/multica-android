/**
 * Standalone attachment list for comment cards.
 *
 * Mirrors the design of web's `AttachmentList` in
 * `packages/views/issues/components/comment-card.tsx:174-215` — renders
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
 * Dispatch mirrors web's `getPreviewKind` order (see `lib/attachment-kind`),
 * which is what makes the two clients agree on what an attachment *is*:
 *
 *   - `image`    → `MarkdownImage`, so standalone and inline images share one
 *                  aspect-ratio + lightbox implementation.
 *   - `html`     → `HtmlAttachmentPreview` (198).
 *   - `markdown` / `text` → `TextAttachmentPreview` — the body is text and the
 *                  `/content` proxy already serves it, so it renders inline
 *                  instead of hiding behind a download.
 *   - `pdf` / `video` / `audio` / `file` → `FileCard`, which downloads with the
 *                  session auth and hands the file to the system handler. Not
 *                  a compromise: Android's WebView has no PDF plugin, and an
 *                  HTML5 media element's sub-request carries no Authorization
 *                  header (measured — `/download` 401s without one), so no
 *                  inline renderer exists for these without a new dependency.
 *                  The system player is also the better phone experience.
 *
 * `lib/attachment-action-parity.test.ts` pins that every kind declared in
 * `ATTACHMENT_KINDS` has a branch here *and* a user-reachable exit on its
 * renderer, so a new kind cannot be added as a dead-end.
 */
import { useMemo } from "react";
import { View } from "react-native";
import type { Attachment } from "@multica/core/types";
import { standaloneAttachments } from "@/lib/attachment-dedup";
import { attachmentKind } from "@/lib/attachment-kind";
import { HtmlAttachmentPreview } from "@/components/rich-content/html-attachment";
import { TextAttachmentPreview } from "@/components/rich-content/text-attachment";
import { FileCard } from "@/components/issue/attachment-file-card";
import { MarkdownImage } from "@/lib/markdown/markdown-image";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import type { DownloadSource } from "@/lib/download-store";

interface Props {
  attachments?: Attachment[];
  /** The comment's markdown content. Attachments referenced inside it via
   *  `![](url)` or `[name](url)` are skipped so they aren't double-rendered.
   *  Pass `undefined` (not just an empty string) when the comment has no
   *  body — that disables the inline-reference filter and renders all
   *  supplied attachments. */
  content?: string;
  /** Where this attachment lives (issue / chat), recorded into the download
   *  manager's history. Pass the issue identifier / session title as `name`
   *  when the caller has it. */
  source?: DownloadSource;
}

export function CommentAttachmentList({ attachments, content, source }: Props) {
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
        const kind = attachmentKind(
          attachment.content_type,
          attachment.filename,
        );
        if (kind === "image") {
          return (
            <MarkdownImage
              key={attachment.id}
              uri={attachment.url}
              alt={attachment.filename}
              attachments={attachments}
            />
          );
        }
        if (kind === "html") {
          return (
            <HtmlAttachmentPreview
              key={attachment.id}
              attachmentId={attachment.id}
              filename={attachment.filename}
              downloadUrl={attachment.download_url}
              contentType={attachment.content_type}
              source={source}
            />
          );
        }
        if (kind === "markdown" || kind === "text") {
          return (
            <TextAttachmentPreview
              key={attachment.id}
              attachmentId={attachment.id}
              filename={attachment.filename}
              downloadUrl={attachment.download_url}
              contentType={attachment.content_type}
              kind={kind}
              source={source}
            />
          );
        }
        // pdf / video / audio / file — one card, distinct glyph per kind.
        return (
          <FileCard
            key={attachment.id}
            attachment={attachment}
            kind={kind}
            theme={theme}
            source={source}
          />
        );
      })}
    </View>
  );
}

