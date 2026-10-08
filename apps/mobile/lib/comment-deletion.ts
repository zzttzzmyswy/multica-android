/**
 * Comment-deletion semantics (iteration 210, #8296).
 *
 * Deleting a comment has two possible server meanings, and which one applies
 * is declared by the deployment in `/api/config`:
 *
 *   - `comment_delete_keep_replies_supported: true` — only that comment goes.
 *     One that still has replies stays as an empty tombstone (empty content,
 *     no attachments, reactions or resolution) so every reply keeps its direct
 *     parent. The server exposes this as
 *     `DELETE /api/comments/:id/keep-replies`; the plain route shares the
 *     handler (`server/cmd/server/router.go`), and the tombstone itself is
 *     written by `TombstoneComment` (`server/pkg/db/queries/comment.sql:661`).
 *   - absent / false — older servers delete the replies too.
 *
 * Web reads the same bit for three things (`packages/views/issues/components/
 * comment-card.tsx` + `packages/core/issues/mutations.ts`): the DELETE route,
 * the confirmation copy, and how the local cache mirrors the outcome. Mobile
 * previously read none of them, so it promised "Replies in the thread will
 * also be removed" and then removed them locally — while the deployment kept
 * them. A later refetch resurrected the replies, so the same data rendered
 * differently on web and mobile.
 *
 * The helpers here are pure so the decision surface is testable without a
 * renderer, and shared by the mutation, the realtime handler and the card.
 * The ones mirroring web's `packages/core/issues/comment-deletion.ts` keep
 * that module's semantics; `isDeletedComment` is why `TimelineEntry`'s
 * `deleted_at` (long documented in `packages/core/types/activity.ts`) finally
 * has a consumer on mobile.
 */
import type { AppConfigResponse } from "@multica/core/api/schemas";
import type { TimelineEntry } from "@multica/core/types";

/**
 * Whether the server keeps a deleted comment's replies (#8296).
 *
 * Anything but an explicit `true` — including a config that has not loaded —
 * reads as "no": an older server deletes the replies too, and only one of the
 * two guesses is safe to show the user before the request runs.
 */
export function commentDeleteKeepsReplies(
  config: AppConfigResponse | undefined,
): boolean {
  return config?.comment_delete_keep_replies_supported === true;
}

/**
 * True for a comment deleted while it still had replies. The server keeps its
 * row as a tombstone so the replies keep their direct parent; clients render
 * nothing in its place except for a thread ROOT, which keeps a placeholder
 * because the thread would otherwise have no head.
 */
export function isDeletedComment(entry: {
  deleted_at?: string | null;
}): boolean {
  return typeof entry.deleted_at === "string" && entry.deleted_at !== "";
}

function hasReplies(
  entries: readonly TimelineEntry[],
  commentId: string,
): boolean {
  return entries.some(
    (e) => e.type === "comment" && e.parent_id === commentId,
  );
}

/**
 * Mirror a keep-replies deletion in the timeline cache: the target becomes an
 * empty tombstone and every reply stays where it was.
 *
 * A comment with NO replies is removed outright, matching the server's
 * `DeleteLeafComment` path — a tombstone there would leave a placeholder with
 * nothing to head. Web's `applyCommentDeletion` makes the same call.
 */
export function applyCommentDeletion(
  entries: TimelineEntry[] | undefined,
  commentId: string,
  deletedAt: string,
): TimelineEntry[] | undefined {
  if (!entries) return entries;
  if (!hasReplies(entries, commentId)) {
    return entries.filter((e) => e.id !== commentId);
  }
  return entries.map((e) =>
    e.id === commentId
      ? {
          ...e,
          content: "",
          attachments: [],
          reactions: [],
          resolved_at: null,
          resolved_by_type: null,
          resolved_by_id: null,
          deleted_at: deletedAt,
        }
      : e,
  );
}

/**
 * Removes a comment and every cached descendant: what a server from before
 * #8296 does on delete, and the only safe reading of a removal event, since a
 * newer server never removes a comment that still has replies.
 */
export function removeCommentSubtree(
  entries: TimelineEntry[] | undefined,
  commentId: string,
): TimelineEntry[] | undefined {
  if (!entries) return entries;
  const removed = new Set<string>([commentId]);
  // Iterate to a fixed point: one forward pass catches direct children, later
  // passes catch reply-to-reply chains. The timeline is p99 ~30 entries, so
  // the worst case is bounded and cheap.
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of entries) {
      if (
        e.type === "comment" &&
        e.parent_id &&
        removed.has(e.parent_id) &&
        !removed.has(e.id)
      ) {
        removed.add(e.id);
        changed = true;
      }
    }
  }
  return entries.filter((e) => !removed.has(e.id));
}
