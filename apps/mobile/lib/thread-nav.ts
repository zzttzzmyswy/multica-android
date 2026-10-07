/**
 * Thread navigator — the pure half of web's
 * `packages/views/issues/components/thread-nav-panel.tsx` plus the preview
 * splitter from `thread-minimap.tsx`.
 *
 * Web pairs two navigators on the issue detail page: a right-edge tick rail
 * (position) and a searchable header panel (finding). Mobile ports the panel
 * only, inside a sheet — web's own comment (`issue-detail.tsx:2519-2523`)
 * says the panel "would work there, but it needs a sheet rather than a
 * popover to be usable one-handed". The rail is deliberately not ported: it
 * is driven by pointer hover and a phone has none.
 *
 * No React / i18n imports: this module runs in the Node vitest lane.
 */
import type { TimelineEntry } from "@multica/core/types";
import { preprocessMentionShortcodes } from "@multica/core/markdown";
import { deriveThreadResolution } from "./thread-resolution";

export type ThreadNavFilter = "all" | "unresolved" | "resolved" | "mine";

export interface ThreadNavThread {
  /** Root comment id — the jump target and the row's stable key. */
  id: string;
  /** The thread's root comment entry (preview text, author, timestamp). */
  entry: TimelineEntry;
  /** Covers reply resolutions too, via the shared derivation. */
  resolved: boolean;
  /** Replies under the root, excluding the root itself. */
  replyCount: number;
  /** The current user authored, replied to, or was @mentioned in this thread. */
  involvesMe: boolean;
}

export type ThreadDayGroup = "today" | "yesterday" | "earlier";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Web `PREVIEW_TITLE_MAX` / `PREVIEW_BODY_MAX` (`thread-minimap.tsx:86-88`). */
const PREVIEW_TITLE_MAX = 80;
const PREVIEW_BODY_MAX = 160;

/**
 * Bucket a thread by the calendar day of its root comment, in the reader's
 * local time zone. Only three buckets: past "yesterday" a per-day header
 * would produce more headers than rows on a long-running issue, which is
 * noise rather than structure — the timestamp on each row already carries
 * the exact date once the reader is in "earlier".
 */
export function threadDayGroup(createdAt: string, nowMs: number): ThreadDayGroup {
  const ts = Date.parse(createdAt);
  if (Number.isNaN(ts)) return "earlier";
  const startOfToday = new Date(nowMs).setHours(0, 0, 0, 0);
  if (ts >= startOfToday) return "today";
  if (ts >= startOfToday - DAY_MS) return "yesterday";
  return "earlier";
}

/** Web `matchesFilter`, ported including its total default arm. */
export function matchesFilter(
  thread: ThreadNavThread,
  filter: ThreadNavFilter,
): boolean {
  switch (filter) {
    case "unresolved":
      return !thread.resolved;
    case "resolved":
      return thread.resolved;
    case "mine":
      return thread.involvesMe;
    case "all":
      return true;
    default:
      // Server-driven values never reach this union, but an exhaustive
      // default keeps a future filter from silently hiding every thread.
      return true;
  }
}

/**
 * Whether `content` @mentions `userId`.
 *
 * Current mentions serialize as markdown links to `mention://member/<uuid>`,
 * but the legacy `[@ id="..." label="..."]` shortcode form is still sitting in
 * the database — `preprocessMarkdown` migrates it *on read*, not before
 * storage, and the timeline hands us raw content. Matching only the link form
 * silently dropped every thread whose sole mention of the reader was written in
 * the old format. `preprocessMentionShortcodes` returns its input untouched
 * when there is no `[@ ` in it, so the normal path costs one substring scan.
 */
export function mentionsUser(
  content: string | undefined,
  userId: string,
): boolean {
  if (!content || !userId) return false;
  return preprocessMentionShortcodes(content).includes(
    `mention://member/${userId}`,
  );
}

/**
 * Split a comment's markdown into a one-line title plus a body excerpt — web
 * `commentPreview` (`thread-minimap.tsx:90`). Code fences collapse to nothing
 * (they carry no scannable text), links degrade to their label, list bullets
 * and emphasis markers are stripped, and every run of whitespace becomes a
 * single space so a wrapped paragraph reads as one line.
 */
export function commentPreview(markdown: string): {
  title: string;
  body: string;
} {
  const lines = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^\s*(?:[-+*]|\d+[.)])\s+/, "")
        .replace(/[#*`>~]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  return {
    title: (lines[0] ?? "").slice(0, PREVIEW_TITLE_MAX),
    body: lines.slice(1).join(" ").slice(0, PREVIEW_BODY_MAX),
  };
}

/** A thread plus everything the row and the filters need, computed once. */
export interface PreparedThread {
  thread: ThreadNavThread;
  /** First line of the root comment, or the author's name when it is empty. */
  title: string;
  excerpt: string;
  authorName: string;
  group: ThreadDayGroup;
  /** Lowercased `title + body + author`, the haystack the query runs against. */
  haystack: string;
}

/**
 * Web's `prepared` memo (`thread-nav-panel.tsx:337-362`), with the name
 * resolver injected instead of read from a hook — this module stays free of
 * React so the Node vitest lane can exercise it.
 *
 * `title` falls back to the author's name for a comment whose body is empty
 * (an attachment-only reply, a bare mention). Without the fallback such a row
 * renders blank and the reader has nothing to aim at.
 */
export function prepareThreads(
  threads: readonly ThreadNavThread[],
  resolveActorName: (entry: TimelineEntry) => string,
  nowMs: number,
): PreparedThread[] {
  return threads.map((thread) => {
    const preview = commentPreview(thread.entry.content ?? "");
    const authorName = resolveActorName(thread.entry);
    const title = preview.title || authorName;
    return {
      thread,
      title,
      excerpt: preview.body,
      authorName,
      group: threadDayGroup(thread.entry.created_at, nowMs),
      haystack: `${title}\n${preview.body}\n${authorName}`.toLowerCase(),
    };
  });
}

/**
 * Web's `rows` memo (`thread-nav-panel.tsx:365-372`): filter and text search
 * are independent and both must pass.
 */
export function filterThreads(
  prepared: readonly PreparedThread[],
  filter: ThreadNavFilter,
  query: string,
): PreparedThread[] {
  const needle = query.trim().toLowerCase();
  return prepared.filter(
    (row) =>
      matchesFilter(row.thread, filter) &&
      (needle === "" || row.haystack.includes(needle)),
  );
}

/** Per-filter counts for the chips. Computed over ALL threads, never the
 *  filtered slice — a chip that counted the filtered set would report 0 the
 *  moment you selected it. */
export function threadFilterCounts(
  threads: readonly ThreadNavThread[],
): Record<ThreadNavFilter, number> {
  return {
    all: threads.length,
    unresolved: threads.filter((thread) => !thread.resolved).length,
    resolved: threads.filter((thread) => thread.resolved).length,
    mine: threads.filter((thread) => thread.involvesMe).length,
  };
}

/**
 * Build the navigator's thread list from a raw timeline.
 *
 * One row per top-level comment, in the timeline's own order (chronological
 * ASC — the same order the reader scrolls).
 *
 * The root/reply split mirrors `lib/timeline-thread.ts` exactly, including its
 * **orphan rescue** (web #1857): a reply whose parent is not in the loaded
 * batch is promoted to a top-level row rather than dropped. Deriving roots
 * from `parent_id` alone would leave such a reply in neither list — the row
 * is visible in the timeline but has no jump target here.
 *
 * `resolved` goes through the shared `deriveThreadResolution` so a thread
 * resolved by replying is marked resolved here exactly as it renders folded in
 * the timeline — deriving it from `root.resolved_at` alone would disagree with
 * what the reader sees.
 */
export function buildThreadNavThreads(
  entries: readonly TimelineEntry[],
  currentUserId: string | null | undefined,
): ThreadNavThread[] {
  const commentIds = new Set<string>();
  for (const entry of entries) {
    if (entry.type === "comment") commentIds.add(entry.id);
  }

  const childrenByParent = new Map<string, TimelineEntry[]>();
  const roots: TimelineEntry[] = [];

  for (const entry of entries) {
    if (entry.type !== "comment") continue;
    if (entry.parent_id && commentIds.has(entry.parent_id)) {
      const siblings = childrenByParent.get(entry.parent_id);
      if (siblings) siblings.push(entry);
      else childrenByParent.set(entry.parent_id, [entry]);
      continue;
    }
    roots.push(entry);
  }

  const userId = currentUserId ?? "";

  return roots.map((root) => {
    // A reply to a reply is bundled under the same root by the timeline
    // builder, so walking the whole subtree keeps `replyCount` equal to what
    // the bubble renders — a one-level count would report a smaller number
    // than the reader can see.
    const replies: TimelineEntry[] = [];
    const queue = [...(childrenByParent.get(root.id) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift()!;
      replies.push(next);
      const children = childrenByParent.get(next.id);
      if (children) queue.push(...children);
    }

    const involvesMe =
      userId !== "" &&
      [root, ...replies].some(
        (entry) =>
          (entry.actor_type === "member" && entry.actor_id === userId) ||
          mentionsUser(entry.content, userId),
      );

    return {
      id: root.id,
      entry: root,
      resolved: deriveThreadResolution(root, replies).kind !== "none",
      replyCount: replies.length,
      involvesMe,
    };
  });
}

/**
 * Group filtered rows into the three day buckets, preserving the incoming
 * (chronological) order inside each. Buckets with no rows are omitted so the
 * list draws no orphan headers.
 */
export function groupPreparedThreads(
  prepared: readonly PreparedThread[],
): Array<{ group: ThreadDayGroup; rows: PreparedThread[] }> {
  const order: ThreadDayGroup[] = ["today", "yesterday", "earlier"];
  return order
    .map((group) => ({
      group,
      rows: prepared.filter((row) => row.group === group),
    }))
    .filter((section) => section.rows.length > 0);
}
