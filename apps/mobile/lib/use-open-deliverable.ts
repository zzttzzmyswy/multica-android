/**
 * Open a deliverable through the exits the comment list already uses.
 *
 * Web's `useOpenAttachment` (`deliverables/use-open-attachment.ts`) tries its
 * page-wide viewer sequence, falls back to opening the file on its own, and
 * downloads as a last resort — one order, so the same tap feels the same
 * wherever it happens. Mobile's equivalent exits already exist and are wired
 * for the comment cards:
 *
 *   1. an image opens the app-level lightbox, positioned inside the issue's
 *      image sequence when one is mounted, so a swipe walks to the next image
 *      exactly as it does from a comment;
 *   2. anything else downloads in-app with the session auth and hands the
 *      bytes to the system handler (`FileCard`'s path). Android's WebView has
 *      no PDF plugin and an HTML5 media element's sub-request carries no
 *      Authorization header, so the system handler is not a compromise here —
 *      it is the only correct exit for these kinds.
 *
 * Deliberately NOT a third preview surface: web routes through the page's
 * preview sequence, and mobile's image lightbox plus the shared file card are
 * that surface's two halves. Adding a deliverable-only viewer would be a second
 * place to keep the "what can open" rules in, which is the drift this project
 * has already paid for once (the `.html` attachment that no renderer could
 * open).
 *
 * The image branch keys off `attachmentKind`, the same dispatcher the comment
 * list uses, so a file cannot be an image in the comment card and not here.
 */
import { useCallback } from "react";
import type { Attachment } from "@multica/core/types";
import { resolveAttachmentUrl } from "@/lib/attachment-url";
import { attachmentKind } from "@/lib/attachment-kind";
import { downloadAttachmentAndOpen } from "@/lib/download-attachment";
import type { DownloadSource } from "@/lib/download-store";
import { useLightbox } from "@/lib/markdown/lightbox-provider";
import { useImageSequence } from "@/lib/markdown/image-sequence";

/**
 * Returns an `open(attachment)` that never rejects: the download path reports
 * its own failures in the downloads history, which is where they can be
 * retried.
 */
export function useOpenDeliverable(
  source?: DownloadSource,
): (attachment: Attachment) => void {
  const { open } = useLightbox();
  const sequence = useImageSequence();

  return useCallback(
    (attachment: Attachment) => {
      const picked =
        attachment.download_url || attachment.markdown_url || attachment.url;
      const uri = resolveAttachmentUrl(picked) ?? picked;
      if (!uri) return;

      if (attachmentKind(attachment.content_type, attachment.filename) === "image") {
        // Position this file inside the issue's images when the sequence holds
        // it; `open` falls back to a single-image view when it does not.
        open(uri, sequence);
        return;
      }

      void downloadAttachmentAndOpen(
        picked,
        attachment.filename,
        attachment.content_type,
        source,
      );
    },
    [open, sequence, source],
  );
}
