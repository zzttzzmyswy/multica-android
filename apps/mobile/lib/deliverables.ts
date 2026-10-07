/**
 * Pure half of the issue "Deliverables" surfaces (MUL-7649).
 *
 * Web renders the files an issue delivered as a sidebar section
 * (`packages/views/issues/components/deliverables/`), with a full-window
 * overview behind "view all". Mobile had no entry point at all: the same
 * timeline that web summarises into a deliverables list showed a phone user
 * nothing about what the issue had produced.
 *
 * What is decided here rather than in the components, and why:
 *
 *   - The grouping and counting rules are web's, lifted out of the JSX so the
 *     Node vitest lane can pin them. Mobile's vitest is Node-only
 *     (`apps/mobile/vitest.config.ts`), so a rule that stays inside a component
 *     is a rule no test can reach.
 *   - `deliverableIconName` and `deliverableTypeLabel` answer "what is this
 *     file" through `attachmentKind` / the extension, so a deliverable and the
 *     comment card that posted it can never disagree about a file's kind.
 *
 * The identity rules themselves are NOT here: `collectDeliverableFiles` and
 * `findDeliverableVersion` come from `@multica/core/attachments/deliverables`,
 * shared with web. Re-deriving "is this the same file" per client is exactly
 * how two clients end up showing different counts for one issue.
 *
 * No React, no i18n: this module runs in the Node vitest lane.
 */
import type { DeliverableFile } from "@multica/core/attachments/deliverables";
import { attachmentKind } from "./attachment-kind";
import { formatBytes } from "./format-bytes";

/** The overview's filters. Every deliverable lands in exactly one. */
export type DeliverableCategory = "image" | "document" | "video" | "other";

export const DELIVERABLE_CATEGORIES: readonly DeliverableCategory[] = [
  "image",
  "document",
  "video",
  "other",
];

/** A file the overview renders as a thumbnail face instead of an icon row. */
const IMAGE_CATEGORY = "image";

/**
 * Documents people read as documents. Data (CSV, JSON) and code are not,
 * even though the viewer shows them as text — nobody filters for "documents"
 * to find a migration script.
 *
 * Mirrors `DOCUMENT_EXTENSIONS` in web's `editor/utils/file-icon.ts`, which is
 * the set `isDocumentFile` consults after its pdf / markdown shortcut.
 */
const DOCUMENT_EXTENSIONS = new Set([
  "pdf", "md", "markdown", "txt", "rtf",
  "doc", "docx", "odt", "pages",
  "ppt", "pptx", "odp", "key",
  "xls", "xlsx", "ods", "numbers",
]);

function extensionOf(filename: string): string {
  const base = (filename ?? "").toLowerCase().split(/[\\/]/).pop() ?? "";
  const withoutQuery = base.split(/[?#]/, 1)[0] ?? "";
  const dot = withoutQuery.lastIndexOf(".");
  if (dot <= 0) return "";
  return withoutQuery.slice(dot + 1);
}

/**
 * The bucket a deliverable belongs to — the same partition web's
 * `deliverableCategory` (`deliverable-kind.ts`) computes, on top of the shared
 * `attachmentKind` dispatcher rather than a second content-type table.
 *
 * `attachmentKind` is mobile's mirror of web's `getPreviewKind`, and web's
 * category helper is itself `getPreviewKind` plus the document set. Routing
 * through it keeps "what is this file" answering once per client.
 */
export function deliverableCategory(
  contentType: string,
  filename: string,
): DeliverableCategory {
  const kind = attachmentKind(contentType, filename);
  if (kind === "image") return "image";
  if (kind === "video") return "video";
  // `attachmentKind` folds web's separate `pdf` and `markdown` kinds into the
  // same two names web's `isDocumentFile` short-circuits on, plus the wider
  // office/document extension set.
  if (kind === "pdf" || kind === "markdown") return "document";
  return DOCUMENT_EXTENSIONS.has(extensionOf(filename)) ? "document" : "other";
}

/** How many deliverables fall in each bucket. Zero for a bucket with none. */
export function deliverableCategoryCounts(
  files: readonly DeliverableFile[],
): Record<DeliverableCategory, number> {
  const counts: Record<DeliverableCategory, number> = {
    image: 0,
    document: 0,
    video: 0,
    other: 0,
  };
  for (const file of files) {
    counts[deliverableCategory(file.latest.content_type, file.latest.filename)] += 1;
  }
  return counts;
}

/**
 * The newest few of each kind, for the sidebar — web's `RECENT_IMAGES` /
 * `RECENT_FILES` caps (`deliverables-section.tsx:16-17`).
 *
 * The two caps are exclusive, not two independent filters: web's loop skips a
 * file that is an image once the image cap is full rather than letting it fall
 * into the file rows, so an image never appears in the sidebar's file list.
 * `files` arrives newest first, so "take the first N" is "the N most recent".
 */
export const RECENT_IMAGES = 3;
export const RECENT_FILES = 4;

export function selectRecentDeliverables(
  files: readonly DeliverableFile[],
): { images: DeliverableFile[]; others: DeliverableFile[] } {
  const images: DeliverableFile[] = [];
  const others: DeliverableFile[] = [];
  for (const file of files) {
    const isImage =
      deliverableCategory(file.latest.content_type, file.latest.filename) ===
      IMAGE_CATEGORY;
    if (isImage && images.length < RECENT_IMAGES) images.push(file);
    else if (!isImage && others.length < RECENT_FILES) others.push(file);
  }
  return { images, others };
}

export interface DeliverableGroup {
  /** The comment these files were posted in. Empty when the record has none. */
  commentId: string;
  files: DeliverableFile[];
}

/**
 * Group an issue's deliverables by the comment that posted each file, oldest
 * group first — web's `groups` memo (`deliverables-overview.tsx:170-193`).
 *
 * A file belongs to the comment that posted its LATEST version: re-uploads are
 * versions of one deliverable, so the group is decided by `latest.comment_id`
 * and the older uploads stay inside their file's row rather than splitting it
 * across two groups.
 *
 * `filter` is a category or `"all"`. Groups left with no files after the filter
 * are dropped, not rendered empty.
 *
 * `commentCreatedAt` resolves a comment id to its timestamp. It is injected
 * rather than read from the timeline so this module stays React-free; an
 * unknown comment (a timeline entry the client has not loaded yet) falls back
 * to its own oldest upload, which web does for the same reason — without it the
 * group would jump to one end of the sheet instead of staying put.
 */
export function groupDeliverablesByComment(
  files: readonly DeliverableFile[],
  filter: "all" | DeliverableCategory,
  commentCreatedAt: (commentId: string) => string | undefined,
): DeliverableGroup[] {
  const byComment = new Map<string, DeliverableFile[]>();

  for (const file of files) {
    if (
      filter !== "all" &&
      deliverableCategory(file.latest.content_type, file.latest.filename) !== filter
    ) {
      continue;
    }
    const commentId = file.latest.comment_id ?? "";
    const group = byComment.get(commentId);
    if (group) group.push(file);
    else byComment.set(commentId, [file]);
  }

  const startedAt = (commentId: string, group: DeliverableFile[]): number => {
    const fromComment = commentCreatedAt(commentId);
    const iso = fromComment ?? group[group.length - 1]!.latest.created_at;
    const ts = Date.parse(iso);
    // An unparseable date would make the comparator return NaN, which sorts
    // arbitrarily; treat it as "no date" so the order stays stable.
    return Number.isNaN(ts) ? 0 : ts;
  };

  const groups: DeliverableGroup[] = [];
  for (const [commentId, groupFiles] of byComment) {
    groups.push({ commentId, files: groupFiles });
  }
  groups.sort((a, b) => startedAt(a.commentId, a.files) - startedAt(b.commentId, b.files));
  // `files` runs newest first; inside a group read them in upload order, which
  // is the order the comment itself listed them in.
  for (const group of groups) group.files.reverse();
  return groups;
}

/** Size string for a deliverable row, or "" when the server sent no size.
 *
 *  Zero means "the server did not report one" (an upload row whose size was not
 *  recorded), not "an empty file" — rendering `0 B` beside a name would claim a
 *  fact the record does not carry, which is why this returns "" rather than
 *  formatting the zero. */
export function deliverableSize(attachment: { size_bytes: number }): string {
  return attachment.size_bytes > 0 ? formatBytes(attachment.size_bytes) : "";
}

/** The extension, uppercased — web's `fileTypeLabel`. Empty when there is none. */
export function deliverableTypeLabel(filename: string): string {
  return extensionOf(filename).toUpperCase();
}

const ICON_BY_KIND: Record<string, DeliverableIconName> = {
  image: "image-outline",
  video: "videocam-outline",
  audio: "musical-notes-outline",
  pdf: "document-text-outline",
  markdown: "document-text-outline",
  html: "document-text-outline",
  text: "document-text-outline",
  file: "document-outline",
};

/**
 * The glyph for a deliverable row and tile.
 *
 * Deliberately routed through `attachmentKind`, the same dispatcher the comment
 * card uses: a `.csv` reads as an archive-free document row in both places
 * rather than one client calling it a spreadsheet and the other a text file.
 * pdf / markdown / html / text share one glyph — they are all "a document you
 * read", and web's own `fileIcon` groups them that way.
 */
export function deliverableIconName(
  contentType: string,
  filename: string,
): DeliverableIconName {
  return ICON_BY_KIND[attachmentKind(contentType, filename)] ?? "document-outline";
}

/** `Ionicons` names this module may return. Kept narrow so a typo in the map
 *  above is a type error rather than a blank glyph at runtime. */
type DeliverableIconName =
  | "image-outline"
  | "videocam-outline"
  | "musical-notes-outline"
  | "document-text-outline"
  | "document-outline";
