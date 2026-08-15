/**
 * Pure, unit-testable helpers for the mobile attachment-download flow.
 *
 * See `lib/download-attachment.ts` for the orchestration that turns these into
 * an authenticated in-app download + system-handler open. Keeping the pure
 * helpers in their own module (no `@/data/api` / expo imports) lets the Node
 * vitest lane cover the filename/MIME safety invariants without loading any
 * RN native module.
 */

/**
 * Reduce an untrusted filename to a safe single-segment basename:
 *   - path separators (`/`, `\`) become `_` so a hostile value can never
 *     traverse out of the cache destination;
 *   - control chars are dropped;
 *   - trailing dots/spaces are trimmed (Android rejects/elides them).
 * Returns `""` for an empty result so callers can fall back to `"download"`.
 */
export function sanitizeBasename(name: string | null | undefined): string {
  if (!name) return "";
  const rendered = name
    .replace(/[\\/]+/g, "_")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[. ]+$/g, "")
    .trim();
  // An input that was purely separators collapses to underscores; treat that
  // (and the empty case) as "no usable basename" so callers fall back.
  if (!rendered) return "";
  if (!rendered.replace(/_/g, "")) return "";
  return rendered;
}

/** Extension → MIME hints for the Android share intent. Unknown or missing
 *  extensions fall back to `fallback`. */
const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
  tgz: "application/gzip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  log: "text/plain",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
};

export function mimeTypeForFilename(
  filename: string,
  fallback = "application/octet-stream",
): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot < 0 || lastDot === filename.length - 1) return fallback;
  const ext = filename.slice(lastDot + 1).toLowerCase();
  return EXT_MIME[ext] ?? fallback;
}