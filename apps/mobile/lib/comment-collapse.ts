/**
 * Per-comment folding rules — the pure half of the comment-collapse feature
 * (the store and the file I/O live in `data/stores/comment-collapse-store.ts`).
 *
 * Web's `packages/core/issues/stores/comment-collapse-store.ts` keeps a
 * `collapsedByIssue: Record<issueId, commentId[]>` and exposes
 * `isCollapsed` / `toggle` / `collapseAll` / `expandAll`. Mobile ports the
 * first two; the fold-all pair is deliberately omitted because mobile has no
 * UI that would drive it (web's "collapse resolved" bar is the only caller),
 * and inventing a control web does not have would be a new surface, not
 * parity.
 *
 * GRANULARITY DIFFERS FROM WEB, on purpose. Web's toggle sits on the root
 * comment's header and hides the root body; its replies are separate
 * `CommentRow`s that never consult the store, so a folded web thread still
 * shows every reply. Mobile renders one bubble per thread (root + all replies
 * stacked inline — see `components/issue/comment-card.tsx`), so a fold that
 * only hid the root body would leave the replies floating under a header with
 * no body. Mobile therefore folds the WHOLE bubble: root body, replies and
 * the reaction bar. That keeps one rule — "the fold hides what the header
 * summarizes" — and the header still carries the author, the time, the
 * 80-char preview and the reply count, which is exactly the summary web's
 * collapsed row shows.
 */

/** Preview length, matching web's collapsed header (`slice(0, 80)`). */
export const COMMENT_PREVIEW_LENGTH = 80;

/** Toggle `commentId` in one issue's collapsed list, preserving order. */
export function toggleCollapsedComment(
  list: readonly string[],
  commentId: string,
): string[] {
  return list.includes(commentId)
    ? list.filter((id) => id !== commentId)
    : [...list, commentId];
}

/** Is `commentId` folded in this issue's list? Absent list → nothing folded. */
export function isCommentCollapsed(
  list: readonly string[] | undefined,
  commentId: string,
): boolean {
  return list?.includes(commentId) ?? false;
}

/**
 * Normalize an untrusted persisted `{ issueId: commentId[] }` map: string
 * keys, string ids, de-duplicated, order preserved; empty lists dropped so a
 * fully-unfolded issue never keeps an entry alive. Non-object input (corrupt
 * file, an older shape) reads as "nothing folded" rather than throwing.
 */
export function normalizeCollapsedComments(
  raw: unknown,
): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [issueId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const id of value) {
      if (typeof id !== "string" || id.length === 0) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (ids.length > 0) out[issueId] = ids;
  }
  return out;
}

/**
 * One-line preview of a folded comment's body: newlines flattened to spaces,
 * trimmed, clipped to `limit` characters. Web does the same in its collapsed
 * header (`(content ?? "").replace(/\n/g, " ").slice(0, 80)`); the trailing
 * ellipsis is the caller's, since the Text node truncates visually anyway.
 */
export function commentPreview(
  content: string | null | undefined,
  limit: number = COMMENT_PREVIEW_LENGTH,
): string {
  const flat = (content ?? "").replace(/\s+/g, " ").trim();
  return flat.length > limit ? flat.slice(0, limit) : flat;
}
