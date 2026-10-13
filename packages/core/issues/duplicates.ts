import type { Issue, IssueDuplicates, UpdateIssueRequest } from "../types";

/**
 * Duplicate marks (MUL-7349), as rules rather than as UI.
 *
 * A duplicate is an ordinary `cancelled` issue that remembers which issue it
 * duplicates — there is no duplicate status. Three consequences shape every
 * helper below, and each is a server rule rather than a UI preference
 * (server/internal/handler/issue_duplicate.go):
 *
 *  - The mark and the status are one write. The server refuses a
 *    `duplicate_of_issue_id` that arrives together with a status other than
 *    `cancelled`, and it refuses to *clear* one: leaving `cancelled` is what
 *    removes a mark.
 *  - The relation is one level deep in both directions. A target must not
 *    itself be a duplicate, and an issue others are marked as duplicates of
 *    cannot be marked. Nothing is re-pointed or collapsed automatically.
 *  - A mark only counts while the issue is cancelled. A pointer an older
 *    server left on a reopened issue is not a mark, so every reader keys off
 *    the status as well as the pointer.
 *
 * This module is the single definition of those rules. `packages/views` has its
 * own `isDuplicateIssue` in `issues/components/issue-duplicates.tsx`, but that
 * file is a React component module the mobile app cannot import, so the mobile
 * client binds to this one instead of writing a third copy.
 */

/** The status a mark writes, and the one that makes it count. */
export const DUPLICATE_STATUS = "cancelled";

/**
 * The status "not a duplicate" writes to.
 *
 * Web's `IssueDuplicateBanner` unmarks with a plain status write to `todo`
 * (`issue-detail.tsx:3279`) — the server clears the pointer itself the moment
 * the status leaves `cancelled`, so no second field is sent. `todo` rather than
 * whatever the issue was before it was cancelled, because the server keeps no
 * such record: a duplicate is cancelled, and a reopen is a fresh decision.
 */
export const DUPLICATE_UNMARK_STATUS = "todo";

/**
 * Whether an issue's duplicate mark currently counts: it is cancelled AND the
 * server resolved an original for it.
 *
 * Both halves are load-bearing. Keying on the pointer alone would draw a banner
 * on a reopened issue whose mark an older server failed to clear; keying on the
 * status alone would claim every cancelled issue duplicates something, with
 * nothing to link to.
 *
 * Takes the minimum it reads, so a list row, a board card and the detail page
 * can all call it with whatever each of them holds.
 */
export function isDuplicateIssue(
  issue: Pick<Issue, "status" | "duplicate_of">,
): boolean {
  return issue.status === DUPLICATE_STATUS && !!issue.duplicate_of;
}

/**
 * The write that marks an issue as a duplicate of `originalId`.
 *
 * One function rather than a call site assembling the pair, because the two
 * fields are only correct together: `duplicate_of_issue_id` alongside any
 * status but `cancelled` is a 400, and the server refuses to combine it with
 * description or attachment changes either. Returning the whole patch makes
 * "what does marking send" a single reviewable object.
 *
 * `duplicate_of_issue_id` is WRITE-ONLY (`UpdateIssueRequest`): it makes the
 * write *do* something but is not a column on `Issue`, whose read side is the
 * resolved `duplicate_of`. Callers must strip it from optimistic cache patches
 * — see {@link DUPLICATE_WRITE_ONLY_FIELDS}.
 */
export function markDuplicatePatch(originalId: string): {
  status: typeof DUPLICATE_STATUS;
  duplicate_of_issue_id: string;
} {
  return { status: DUPLICATE_STATUS, duplicate_of_issue_id: originalId };
}

/**
 * The write that removes a mark: a plain status change out of `cancelled`.
 *
 * Deliberately sends no `duplicate_of_issue_id`. The field is not nullable —
 * the server answers `null` with "change the status to remove a duplicate
 * mark" — so this is the only correct shape, and keeping it in one place stops
 * a caller from trying to null the pointer.
 */
export function unmarkDuplicatePatch(): { status: string } {
  return { status: DUPLICATE_UNMARK_STATUS };
}

/**
 * The row an unmarked issue becomes, for an optimistic cache patch.
 *
 * Clears the status and the pointer together, because they are one state
 * server-side: a mark only counts while the issue is cancelled. Writing the
 * status alone would produce a row the server never returns — a `todo` issue
 * still holding an original, which is exactly the combination
 * `isDuplicateIssue` refuses to draw a banner for. A reader shown that
 * intermediate row would be looking at a state that means nothing.
 *
 * A row with nothing to clear is returned by IDENTITY, so a caller can map this
 * over a whole list cache without churning the identity of untouched rows — a
 * fresh object per row would re-render the entire list for a write that touched
 * one issue. "Nothing to clear" is spelled out as BOTH conditions rather than
 * `!isDuplicateIssue`: a reopened issue that still carries a stale pointer is
 * not a duplicate, but it does have something to clean, and a guard keyed on
 * the mark alone would skip it and leave the impossible combination in place.
 */
export function unmarkDuplicateIssue(issue: Issue): Issue {
  const isCancelled = issue.status === DUPLICATE_STATUS;
  if (!isCancelled && !issue.duplicate_of) return issue;
  return { ...issue, status: DUPLICATE_UNMARK_STATUS, duplicate_of: null };
}

/**
 * Update-patch fields that belong on the wire and NOT in a cache.
 *
 * Control fields: they change what the write does without corresponding to a
 * column on `Issue`. Patching one into an optimistic row puts a phantom field
 * on screen until the settle refetch replaces the row with the server's. The
 * mutations destructure against this list rather than re-deciding per hook, so
 * the set has one definition to review.
 */
export const DUPLICATE_WRITE_ONLY_FIELDS = [
  "duplicate_of_issue_id",
] as const satisfies readonly (keyof UpdateIssueRequest)[];

/**
 * The two error codes a mark can be refused with
 * (server/internal/handler/issue_duplicate.go `writeDuplicateMarkError`).
 *
 * Named here rather than written as literals at the alert, so the strings
 * cannot drift from the server's and a test can pin them. `errorCode`
 * (packages/core/api/client.ts) reads the code off the response body.
 */
export const DUPLICATE_TARGET_IS_DUPLICATE = "duplicate_target_is_duplicate";
export const ISSUE_HAS_DUPLICATES = "issue_has_duplicates";

/**
 * Whether a candidate may serve as an *original*.
 *
 * Web's `notDuplicate` (`modals/mark-duplicate-issue.tsx:26`) is exactly this
 * predicate, applied to suggestions and search results alike. An issue that is
 * already a duplicate cannot be one: the server refuses that target with
 * `duplicate_target_is_duplicate`, and the reader's remedy is to pick *that*
 * issue's original instead — which lives in its `duplicate_of`, one hop away.
 */
export function canBeDuplicateOriginal(candidate: Issue): boolean {
  return !isDuplicateIssue(candidate);
}

/**
 * The ids a mark may not target: the issue itself (it cannot duplicate itself —
 * the server 400s) and its own duplicates (a duplicate of a duplicate is the
 * one-level-deep rule the server enforces with `issue_has_duplicates`).
 *
 * Issues the user has merely *viewed* are not excluded — those are suggestions,
 * and one of them being the original is the common case.
 */
export function duplicateTargetExclusions(
  issueId: string,
  relations: Pick<IssueDuplicates, "duplicates"> | undefined,
): string[] {
  const ids = new Set<string>([issueId]);
  for (const duplicate of relations?.duplicates ?? []) ids.add(duplicate.id);
  return [...ids];
}
