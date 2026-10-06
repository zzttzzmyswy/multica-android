/**
 * What the fullscreen image viewer needs to know about each image it shows.
 *
 * Mirrors the web preview modal's header (`packages/views/editor/
 * attachment-preview-modal.tsx:557-625`): the filename, and a Download button
 * that hands the file back to the user. Mobile's viewer is
 * `react-native-image-viewing`, which carries a URI and nothing else — so the
 * sequence feeding it has to keep the filename and a fetchable URL alongside
 * the URI, or the header has nothing to render.
 *
 * `canDownload` is true only for an image backed by a workspace attachment
 * record. Web's modal sends a URL-only source to `openExternal` instead of its
 * download path; on mobile an authenticated fetch of an arbitrary third-party
 * host would attach the session Bearer token to a foreign origin — the exact
 * leak `isAttachmentDownloadUrl`'s host gate exists to prevent
 * (`lib/attachment-download.ts`). No record, no button.
 *
 * The URL to fetch is the same `uri` the viewer paints: `collectImageSequence`
 * already picks `download_url → markdown_url → url` for an attachment
 * (`packages/core/attachments/image-sequence.ts:340-347`), and `MarkdownImage`
 * resolves the URI it renders through that same order. Copying the order here
 * would be a second policy to keep in sync for no gain.
 *
 * Pure: the URL resolver is injected so the Node vitest lane covers the mapping
 * without loading `@/data/server-config` (which pulls in expo-secure-store).
 */

import type { ImageSequenceItem } from "@multica/core/attachments/image-sequence";
import type { DownloadSource } from "@/lib/download-store";

export interface LightboxImage {
  /** Loadable URI — what the viewer paints and what `open` keys on. */
  uri: string;
  /** Shown in the viewer header. Empty for references with no filename. */
  filename: string;
  /**
   * Whether the header offers Download. False for an image with no attachment
   * record behind it (an inline external `https://` link, or a composer chip
   * that exists only on disk) — there is no URL whose fetch is both meaningful
   * and safe to authenticate.
   */
  canDownload: boolean;
  /** MIME hint for the system share sheet, when the record carries one. */
  mimeType?: string;
  /** Which surface this image belongs to, for the downloads list's source
   *  column. Derived from the record's own parent pointers, so the app-level
   *  provider needs no prop threading from the screen that mounted it. */
  source: DownloadSource;
}

/**
 * Map a screen's collected image sequence into viewer images.
 *
 * The URI is resolved exactly as `image-sequence.tsx` resolved the bare URIs it
 * used to hold, so the URI a tap reports still matches the one in the sequence
 * and the viewer still opens at the right position.
 */
export function toLightboxImages(
  items: ReadonlyArray<ImageSequenceItem>,
  resolve: (url: string) => string | null,
): LightboxImage[] {
  return items.map((item) => ({
    uri: resolve(item.url) ?? item.url,
    filename: item.filename ?? "",
    canDownload: Boolean(item.attachment),
    mimeType: item.attachment?.content_type,
    source: downloadSourceForAttachment(item.attachment),
  }));
}

/**
 * Position of `uri` in `images`, or -1 when it is not part of them.
 *
 * -1 is the caller's cue to fall back to a single-image view — the same
 * contract web's `openAt` reports by returning false
 * (`packages/views/editor/image-sequence-context.tsx:64`).
 */
export function indexOfImageByUri(
  images: ReadonlyArray<LightboxImage>,
  uri: string,
): number {
  if (!uri) return -1;
  return images.findIndex((image) => image.uri === uri);
}

/**
 * Title for the viewer header: the filename, or `fallback` for a reference the
 * attachment list never resolved (an inline external image has no name).
 */
export function imageHeaderTitle(
  image: LightboxImage | undefined,
  fallback: string,
): string {
  return image?.filename || fallback;
}

/**
 * Which surface a download from the viewer originated on, for the downloads
 * list's source column (`lib/download-store.ts`).
 *
 * Derived from the attachment record's own parent pointers rather than passed
 * down from the screen: the provider is app-level and cannot see which surface
 * mounted it, while the record already knows whether it hangs off an issue or a
 * chat message. Attachment-less / parentless records fall back to `other`,
 * which is the same bucket the composer chips land in.
 */
export function downloadSourceForAttachment(
  attachment: ImageSequenceItem["attachment"],
): DownloadSource {
  if (attachment?.issue_id) return { kind: "issue" };
  if (attachment?.chat_session_id || attachment?.chat_message_id) {
    return { kind: "chat" };
  }
  return { kind: "other" };
}
