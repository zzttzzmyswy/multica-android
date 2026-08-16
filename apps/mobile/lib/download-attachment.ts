/**
 * Authenticated in-app attachment download + system-handler open, routed
 * through the download manager.
 *
 * MYS-270 (original): handing `download_url` to `Linking.openURL` pushed the
 * request to the external browser, which carries no `Authorization` header,
 * so the server rejected it with `missing authorization`. Downloads have to
 * happen in-app with the session token (it stays inside ApiClient — never
 * logged or exposed).
 *
 * MYS-336 (this iteration): the app-wide download manager replaced the
 * previous fire-and-forget `api.downloadFile` + immediate share. Every
 * attachment download now registers a task in `useDownloadsStore` — visible
 * in More → Downloads with progress, an entry in the persisted history, and
 * retry/cancel support — and the manager presents the system handler sheet
 * (`expo-sharing`) itself when the download completes, re-exposing the
 * cached `file://` URI as a content URI to avoid Android's
 * FileUriExposedException.
 *
 * Pure helpers (`sanitizeBasename`, `mimeTypeForFilename`) live in
 * `lib/attachment-download.ts` so the safety invariants are unit-tested in
 * the Node vitest lane.
 */
import { useDownloadsStore } from "@/data/downloads-store";
import type { DownloadSource } from "@/lib/download-store";

export type { LocalDownload } from "@/data/api";

/**
 * Register `rawUrl` with the download manager and await its terminal state.
 * The manager runs the authenticated download, records progress/history
 * (persistently), and opens the saved file through the system handler sheet
 * on success. `mimeType` is optional — when absent it is derived from
 * `filename` so Android can route the share intent.
 *
 * Never rejects: user-facing failure surfaces in the download history with
 * the reason, where it can be retried or deleted. The raw URL may be
 * server-relative; the ApiClient resolves it against the current base.
 */
export async function downloadAttachmentAndOpen(
  rawUrl: string,
  filename: string,
  mimeType?: string,
  source?: DownloadSource,
): Promise<void> {
  await useDownloadsStore.getState().downloadAndOpen(
    rawUrl,
    filename,
    mimeType,
    source,
  );
}