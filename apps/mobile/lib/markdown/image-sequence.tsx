/**
 * Screen-scoped image sequence for the lightbox (MUL-5752).
 *
 * A screen that can show several images (an issue: description + every
 * comment; a chat session: every message) mounts this once with its blocks in
 * render order. Every `MarkdownImage` below it then opens the lightbox
 * positioned inside that sequence instead of on its own, so a swipe walks to
 * the next image and the viewer can say "3 / 7".
 *
 * Mirrors the web/desktop `ImageSequenceProvider`
 * (packages/views/editor/image-sequence-context.tsx) — same product contract,
 * different presentation. The ordering itself is NOT re-derived here: both
 * clients call `collectImageSequence` from @multica/core so an issue's images
 * are counted the same way on every client (mobile parity rule: mirror the
 * shared logic, own the UI).
 *
 * The URIs are resolved the same way `MarkdownImage` resolves the one it
 * renders — same attachment match, same `resolveAttachmentUrl` pass — so the
 * URI a tap reports is the one the sequence holds.
 *
 * Each entry carries the filename and record behind that URI too, because the
 * viewer's header renders both (see `lightbox-image.ts`). Holding bare URIs
 * here is what made the image kind the one attachment a user could view
 * full-screen and never save.
 */
import { createContext, use, useMemo, type ReactNode } from "react";
import {
  collectImageSequence,
  type ImageSequenceBlock,
} from "@multica/core/attachments/image-sequence";
import { resolveAttachmentUrl } from "@/lib/attachment-url";
import { toLightboxImages, type LightboxImage } from "./lightbox-image";

const ImageSequenceContext = createContext<readonly LightboxImage[]>([]);

/**
 * Images for the surrounding screen, in render order, with the filename and
 * record each needs. Empty when no provider is mounted — the lightbox then
 * shows the tapped image alone.
 */
export function useImageSequence(): readonly LightboxImage[] {
  return use(ImageSequenceContext);
}

export function ImageSequenceProvider({
  blocks,
  children,
}: {
  blocks: ReadonlyArray<ImageSequenceBlock | null | undefined>;
  children: ReactNode;
}) {
  const images = useMemo(
    () => toLightboxImages(collectImageSequence(blocks), resolveAttachmentUrl),
    [blocks],
  );
  return (
    <ImageSequenceContext.Provider value={images}>
      {children}
    </ImageSequenceContext.Provider>
  );
}
