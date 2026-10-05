/**
 * Which renderer a standalone attachment row gets — the mobile mirror of web's
 * `getPreviewKind` (`packages/views/editor/utils/preview.ts:172`), narrowed to
 * the kinds the standalone list can render.
 *
 * Why this is a named function and not an inline `content_type === "text/html"`
 * check: the server types every upload with Go's `http.DetectContentType`,
 * which appends a charset parameter to text types. A real `.html` upload comes
 * back as `text/html; charset=utf-8`, so a bare `"text/html"` comparison never
 * matched and the HTML renderer was unreachable — every HTML attachment fell
 * through to the file card, and its inline preview (and the actions on it) was
 * dead code. Verified against the live server: five `.html` uploads, every one
 * typed `text/html; charset=utf-8`.
 *
 * Web never had the bug because it normalizes (strip parameters, lowercase)
 * and also falls back to the extension. Matching the same way — normalized
 * content type plus extension, exactly as `getPreviewKind` orders its branches
 * — is what makes the two clients agree on what an attachment *is*.
 */
import { isImageAttachment } from "@multica/core/attachments/image-sequence";

/** Every kind the standalone attachment list can render. Adding one without a
 *  branch in `comment-attachment-list.tsx` (and without an exit affordance on
 *  its renderer) fails `lib/attachment-action-parity.test.ts`. */
export const ATTACHMENT_KINDS = ["image", "html", "file"] as const;

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

function normalizeContentType(contentType: string): string {
  const ct = (contentType ?? "").toLowerCase().trim();
  const semi = ct.indexOf(";");
  return (semi >= 0 ? ct.slice(0, semi) : ct).trim();
}

function extensionOf(filename: string): string {
  const base = (filename ?? "").toLowerCase().split(/[\\/]/).pop() ?? "";
  const withoutQuery = base.split(/[?#]/, 1)[0] ?? "";
  const dot = withoutQuery.lastIndexOf(".");
  if (dot <= 0) return "";
  return withoutQuery.slice(dot + 1);
}

/**
 * Images are tested first, before the html branch, because the two overlap:
 * `.svg` is both an image extension and text-like XML, and `isImageAttachment`
 * owns that decision (shared with the lightbox sequence builder, so the card
 * and the viewer can't disagree about what counts as an image).
 */
export function attachmentKind(
  contentType: string,
  filename: string,
): AttachmentKind {
  if (isImageAttachment(contentType, filename)) return "image";
  const ct = normalizeContentType(contentType);
  const ext = extensionOf(filename);
  if (ct === "text/html" || ext === "html" || ext === "htm") return "html";
  return "file";
}
