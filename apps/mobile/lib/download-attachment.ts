/**
 * Authenticated in-app attachment download + system-handler open.
 *
 * Fixes MYS-270: the composer file-chip and comment file-card used to hand
 * `download_url` to `Linking.openURL`, pushing the request to the external
 * browser. In token-mode the browser tab carries no `Authorization` header, so
 * the server rejected it with `missing authorization`. This module replaces
 * that handoff with:
 *
 *   1. an in-app, authenticated download to the app cache via
 *      `api.downloadFile` (token stays inside ApiClient — never logged or
 *      exposed), then
 *   2. `expo-sharing`'s system handler sheet so the user opens the file with
 *      any installed app (expo-sharing safely re-exposes the cached `file://`
 *      URI as a content URI, avoiding Android's FileUriExposedException).
 *
 * Pure helpers (`sanitizeBasename`, `mimeTypeForFilename`) live in
 * `lib/attachment-download.ts` so the safety invariants are unit-tested in the
 * Node vitest lane.
 */
import { api, type LocalDownload } from "@/data/api";
import * as Sharing from "expo-sharing";
import { mimeTypeForFilename } from "@/lib/attachment-download";

export type { LocalDownload };

/**
 * Download `rawUrl` in-app with the session auth headers, then open the saved
 * file through the system handler sheet. `mimeType` is optional — when absent
 * it is derived from `filename` so Android can route the share intent.
 *
 * Throws `ApiError` on any failure (network, 401/403, write error) — callers
 * translate to a user-facing alert. The raw URL may be server-relative; the
 * ApiClient resolves it against the current base.
 */
export async function downloadAttachmentAndOpen(
  rawUrl: string,
  filename: string,
  mimeType?: string,
): Promise<void> {
  const local = await api.downloadFile(rawUrl, filename);
  const shareMime = mimeType ?? mimeTypeForFilename(local.name);
  await Sharing.shareAsync(local.uri, { mimeType: shareMime });
}