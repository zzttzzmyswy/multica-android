/**
 * Which renderer a standalone attachment row gets — the mobile mirror of web's
 * `getPreviewKind` (`packages/views/editor/utils/preview.ts:172`).
 *
 * Why this is a named function and not an inline `content_type === "text/html"`
 * check: the server types every upload with Go's `http.DetectContentType`,
 * which appends a charset parameter to text types. A real `.html` upload comes
 * back as `text/html; charset=utf-8`, so a bare `"text/html"` comparison never
 * matched and the HTML renderer was unreachable. Verified against the live
 * server: five `.html` uploads, every one typed `text/html; charset=utf-8`.
 *
 * Web never had the bug because it normalizes (strip parameters, lowercase)
 * and also falls back to the extension. Matching the same way — normalized
 * content type plus extension, exactly as `getPreviewKind` orders its branches
 * — is what makes the two clients agree on what an attachment *is*.
 *
 * Branch order is load-bearing and copies `getPreviewKind` verbatim
 * (pdf → video → audio → image → markdown → html → text → null):
 *
 *   - media before image, because a `video/*` or `audio/*` upload is never an
 *     image and the two sets do not overlap;
 *   - image before markdown/html/text, because `.svg` is both an image
 *     extension and text-like XML, and `isImageAttachment` owns that decision
 *     (shared with the lightbox sequence builder, so the card and the viewer
 *     can't disagree about what counts as an image);
 *   - markdown before html/text, because `.md` is text-like and the server
 *     sniffs it as plain text;
 *   - html before text for the same reason.
 *
 * `content_type` here is the value the server stores and returns in the
 * attachment record. Deliberately NOT the `X-Original-Content-Type` header
 * from the `/content` proxy: that header is set to the very same
 * `att.ContentType` column (`server/internal/handler/file.go:1288` vs `:170`),
 * so it carries no information the record does not already have. Measured on
 * `mu.zztweb.top` across 13 uploads (md / txt / html / json / py / yaml / css /
 * log / rtf / Dockerfile / extensionless): the two values were byte-identical
 * every time. Reading it would only add a network round-trip to a decision
 * that is already synchronously answerable.
 */
import { isImageAttachment } from "@multica/core/attachments/image-sequence";

/** Every kind the standalone attachment list can render. Adding one without a
 *  branch in `comment-attachment-list.tsx` (and without an exit affordance on
 *  its renderer) fails `lib/attachment-action-parity.test.ts`. */
export const ATTACHMENT_KINDS = [
  "image",
  "pdf",
  "video",
  "audio",
  "markdown",
  "html",
  "text",
  "file",
] as const;

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** Text-ish content types that are not covered by the `text/` prefix.
 *  Mirrors `TEXT_CONTENT_TYPES` in web's preview.ts. */
const TEXT_CONTENT_TYPES = new Set([
  "application/json",
  "application/javascript",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "application/toml",
  "application/x-sh",
  "application/x-httpd-php",
]);

/** Extensions the server's text-preview proxy accepts. Mirrors web's
 *  `TEXT_EXTENSIONS`, which is itself kept in sync with `isTextPreviewable`
 *  in `server/internal/handler/file.go:1321` — if an extension is classified
 *  `text` here but the proxy rejects it, the user gets a 415 placeholder. */
const TEXT_EXTENSIONS = new Set([
  "md", "markdown", "txt", "log", "csv", "tsv",
  "html", "htm", "json", "xml",
  "yml", "yaml", "toml", "ini", "conf",
  "dockerfile", "makefile", "gitignore",
  "sh", "bash", "zsh",
  "py", "rb", "go", "rs",
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "css", "scss", "sass", "less",
  "sql",
  "java", "kt", "swift",
  "c", "cc", "cpp", "h", "hpp",
  "cs", "php", "lua", "vim",
]);

/** Extension-less build files that are text. Mirrors web's `TEXT_BASENAMES`. */
const TEXT_BASENAMES = new Set(["dockerfile", "makefile", ".env", ".gitignore"]);

/** Media extension fallbacks. Used when `content_type` is generic
 *  (`application/octet-stream`) or empty. Mirrors web's `VIDEO_EXTS` /
 *  `AUDIO_EXTS`. */
const VIDEO_EXTENSIONS = new Set([
  "mp4", "m4v", "mov", "webm", "mkv", "avi", "ogv",
]);
const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "m4a", "ogg", "oga", "flac", "aac", "opus",
]);

function normalizeContentType(contentType: string): string {
  const ct = (contentType ?? "").toLowerCase().trim();
  const semi = ct.indexOf(";");
  return (semi >= 0 ? ct.slice(0, semi) : ct).trim();
}

function basenameOf(filename: string): string {
  return (filename ?? "").toLowerCase().split(/[\\/]/).pop() ?? "";
}

function extensionOf(filename: string): string {
  const base = basenameOf(filename);
  const withoutQuery = base.split(/[?#]/, 1)[0] ?? "";
  const dot = withoutQuery.lastIndexOf(".");
  if (dot <= 0) return "";
  return withoutQuery.slice(dot + 1);
}

/** True when the file's body is text and therefore fetchable through the
 *  `/api/attachments/{id}/content` proxy. Mirrors web's `isTextLike`. */
function isTextLike(contentType: string, filename: string): boolean {
  const ct = normalizeContentType(contentType);
  if (ct.startsWith("text/")) return true;
  if (TEXT_CONTENT_TYPES.has(ct)) return true;
  const ext = extensionOf(filename);
  if (ext && TEXT_EXTENSIONS.has(ext)) return true;
  return TEXT_BASENAMES.has(basenameOf(filename));
}

export function attachmentKind(
  contentType: string,
  filename: string,
): AttachmentKind {
  const ct = normalizeContentType(contentType);
  const ext = extensionOf(filename);

  // Media before image: disjoint sets, ordered as web orders them.
  if (ct === "application/pdf" || ext === "pdf") return "pdf";
  if (ct.startsWith("video/") || VIDEO_EXTENSIONS.has(ext)) return "video";
  if (ct.startsWith("audio/") || AUDIO_EXTENSIONS.has(ext)) return "audio";

  // Image before the text-like branches because `.svg` is both an image
  // extension and XML; `isImageAttachment` owns that call.
  if (isImageAttachment(contentType, filename)) return "image";

  // Markdown covers both the well-typed case and the server's sniffer
  // fallback (a real `.md` upload is typed `text/plain; charset=utf-8`).
  if (ct === "text/markdown" || ext === "md" || ext === "markdown") {
    return "markdown";
  }
  if (ct === "text/html" || ext === "html" || ext === "htm") return "html";

  if (isTextLike(contentType, filename)) return "text";
  return "file";
}
