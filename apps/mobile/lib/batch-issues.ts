/**
 * Pure helpers for optimistic batch issue writes (web parity with
 * packages/core/issues/mutations.ts useBatchUpdateIssues / useBatchDeleteIssues).
 * Batch actions touch status / priority / assignee only — description and
 * control fields (suppress_run, handoff_note) are not optimistically patched;
 * the server resolves those authoritatively on refetch.
 */
import type { Issue, UpdateIssueRequest } from "@multica/core/types";

/** Apply the patchable subset of an UpdateIssueRequest onto one issue. */
export function applyBatchIssuePatch(
  issue: Issue,
  patch: UpdateIssueRequest,
): Issue {
  const next: Issue = { ...issue };
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.assignee_type !== undefined)
    next.assignee_type = patch.assignee_type ?? null;
  if (patch.assignee_id !== undefined) next.assignee_id = patch.assignee_id ?? null;
  return next;
}

/** Map over an issue list, patching only the rows whose id is in `ids`. */
export function patchIssueBatch(
  issues: Issue[],
  ids: string[],
  patch: UpdateIssueRequest,
): Issue[] {
  if (ids.length === 0) return issues.slice();
  const target = new Set(ids);
  return issues.map((issue) =>
    target.has(issue.id) ? applyBatchIssuePatch(issue, patch) : issue,
  );
}

/** Return a new list without the rows whose id is in `ids`. */
export function dropIssueBatch(issues: Issue[], ids: string[]): Issue[] {
  if (ids.length === 0) return issues.slice();
  const drop = new Set(ids);
  return issues.filter((issue) => !drop.has(issue.id));
}