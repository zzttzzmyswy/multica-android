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

// ---------------------------------------------------------------------------
// Download-URL recognition (MYS-327)
// ---------------------------------------------------------------------------

/**
 * UUID shape canonical to the backend's attachment download endpoints —
 * kept in sync with `lib/markdown/preprocess.ts` (same literal). Used to
 * recognize a download URL in a tapped markdown link, where the earlier
 * MYS-270 fix (attachment cards in the message) does not apply.
 */
const ATTACHMENT_UUID =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/** Server paths that require the session auth header to download:
 *  stable `/api/attachments/<uuid>/download` (the persisted `markdown_url`
 *  shape — the server self-resigns/proxies it on every request) and
 *  `/uploads/<file>` (storage-relative). A bare `/uploads/` directory (no
 *  file) and malformed UUIDs do not match, so a stray link can't be
 *  intercepted as a download. */
const DOWNLOAD_PATH_RE = new RegExp(
  `^/api/attachments/${ATTACHMENT_UUID}/download([?#]|$)|^/uploads/[^?#]`,
);

function stripQueryAndFragment(url: string): string {
  const q = url.indexOf("?");
  const h = url.indexOf("#");
  if (q < 0 && h < 0) return url;
  const cut = q < 0 ? h : h < 0 ? q : Math.min(q, h);
  return url.slice(0, cut);
}

/**
 * True when tapping `rawUrl` should download the file in-app with the session
 * auth instead of handing it to an external browser.
 *
 * The browser tab that `Linking.openURL` would open carries no `Authorization`
 * header, so the backend rejects attachment/upload downloads with
 * `missing authorization` (MYS-327, MYS-270). Matches:
 *   - server-relative `/api/attachments/<uuid>/download` and `/uploads/...`
 *     paths (no host — always our API origin), and
 *   - absolute http(s) URLs with one of those paths whose host equals the API
 *     or public web base, or is a subdomain of one (a self-hosted deployment
 *     may split its API and web frontends across subdomains, e.g. the
 *     persisted `markdown_url` on `api.example.test` while the app is pointed
 *     at `example.test`). Presigned CDN URLs — foreign host or a host that
 *     shares no suffix with either base — stay browser-routable: intercepting
 *     them would send the Bearer token to a third party, which is why the
 *     host gate is load-bearing.
 *
 * The hosts are compared after passing them in so this stays pure (the
 * caller reads the live base from `server-config`).
 */
export function isAttachmentDownloadUrl(
  rawUrl: string,
  apiBase: string,
  webBase = apiBase,
): boolean {
  if (!rawUrl) return false;
  const isRelative = rawUrl.startsWith("/");
  const isHttp = /^https?:\/\//i.test(rawUrl);
  if (!isRelative && !isHttp) return false;

  let path: string;
  if (isRelative) {
    path = rawUrl;
  } else {
    try {
      const url = new URL(rawUrl);
      const baseHost = new URL(apiBase).host;
      const webHost = new URL(webBase).host;
      if (
        !hostMatches(url.host, baseHost) &&
        !hostMatches(url.host, webHost)
      ) {
        return false;
      }
      path = url.pathname;
    } catch {
      return false;
    }
  }
  return DOWNLOAD_PATH_RE.test(stripQueryAndFragment(path));
}

/** Host equality or same-zone subdomain (`api.zone.test` ⊂ `zone.test`).
 *  Leading-dot comparison prevents prefix-boundary false positives
 *  (`notzone.test` never matches `.zone.test`). */
function hostMatches(rawHost: string, baseHost: string): boolean {
  const raw = rawHost.toLowerCase();
  const base = baseHost.toLowerCase();
  return raw === base || raw.endsWith(`.${base}`);
}

/**
 * Rewrite an absolute attachment download URL onto `base` (our configured API
 * origin) so the authenticated request always targets the origin the user
 * configured — never the host embedded in `rawUrl`. A persisted markdown_url
 * may point at a sibling ingress (`api.example.test`) while the app's base is
 * `example.test`; both serve the same backend, but the bearer token must only
 * travel to the configured base. Server-relative URLs are already
 * base-relative and pass through unchanged; non-http(s) returns `null`.
 */
export function rebaseDownloadUrl(
  rawUrl: string,
  base: string,
): string | null {
  if (!rawUrl) return null;
  if (rawUrl.startsWith("/")) return rawUrl;
  if (!/^https?:\/\//i.test(rawUrl)) return null;
  try {
    const url = new URL(rawUrl);
    const trimmedBase = base.replace(/\/+$/, "");
    if (!trimmedBase) return null;
    return `${trimmedBase}${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/**
 * Fallback filename for a download URL when the tap never resolves to an
 * `Attachment` record: the last URL path segment, percent-decoded. The
 * generic `/api/attachments/<uuid>/download` endpoint carries no name (its
 * last segment is literally "download"), so it folds back to `fallback` —
 * callers that also have the attachment list should prefer
 * `Attachment.filename` first.
 */
export function filenameFromDownloadUrl(
  rawUrl: string,
  fallback = "download",
): string {
  if (!rawUrl) return fallback;
  const withoutQuery = stripQueryAndFragment(rawUrl);
  const lastSegment = withoutQuery.split("/").pop();
  if (!lastSegment || lastSegment === "download") return fallback;
  try {
    return decodeURIComponent(lastSegment);
  } catch {
    return lastSegment;
  }
}
