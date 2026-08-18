/**
 * Pure helpers for optimistic batch issue writes (web parity with
 * packages/core/issues/mutations.ts useBatchUpdateIssues / useBatchDeleteIssues).
 * Batch actions touch status / priority / assignee only — description and
 * control fields (suppress_run, handoff_note) are not optimistically patched;
 * the server resolves those authoritatively on refetch.
 */
import type {
  Issue,
  IssueAssigneeType,
  IssuePriority,
  IssueStatus,
  UpdateIssueRequest,
} from "@multica/core/types";

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

/**
 * Shared assignee across a selection. `{ type: null, id: null }` means every
 * selected issue is unassigned — a real shared value, distinct from a mixed
 * selection (which {@link commonIssueFields} reports as `assignee: null`).
 * Mirrors web `CommonAssignee` (packages/core/issues/batch.ts).
 */
export interface CommonAssignee {
  type: IssueAssigneeType | null;
  id: string | null;
}

/**
 * The status / priority / assignee shared by every issue in a batch selection.
 * A field is `null` when the selection is empty or the issues disagree
 * ("mixed"); the batch pickers use this to reflect the real common value and
 * fall back to an empty (no-checkmark) state when the values differ, instead
 * of asserting a hardcoded default. Mirrors web `CommonIssueFields`.
 */
export interface CommonIssueFields {
  status: IssueStatus | null;
  priority: IssuePriority | null;
  assignee: CommonAssignee | null;
}

/**
 * Returns the value shared by every item, or `null` when the list is empty or
 * the items disagree. Comparison is by primitive equality, so callers pass a
 * scalar key (collapse composite values to a string before calling).
 */
function sharedValue<T>(values: readonly T[]): T | null {
  if (values.length === 0) return null;
  const first = values[0]!;
  return values.every((v) => v === first) ? first : null;
}

const ASSIGNEE_KEY_SEP = "\u0000";

/**
 * Collapse a polymorphic assignee (type + id, either nullable) into a single
 * comparable key so all-unassigned issues compare equal to each other and
 * distinct from any assigned actor.
 */
function assigneeKey(type: IssueAssigneeType | null, id: string | null): string {
  return `${type ?? ""}${ASSIGNEE_KEY_SEP}${id ?? ""}`;
}

/**
 * Whether assigning the given actor to this selection should route through the
 * run-confirm dialog (web issue-run-confirm semantics). Members and clearing
 * the assignee can never start a run and apply directly; agent/squad
 * assignment may start runs, EXCEPT when every selected issue is in backlog —
 * a parking-lot assignment can never start one (web handleBatchAssignee
 * short-circuit).
 */
export function needRunConfirm(
  issues: readonly Issue[],
  assigneeType: IssueAssigneeType | null | undefined,
): boolean {
  if (assigneeType !== "agent" && assigneeType !== "squad") return false;
  return !issues.every((i) => i.status === "backlog");
}

/**
 * Derive the common status / priority / assignee of the selected issues.
 * Pass the already-filtered selection (the issues that are actually selected),
 * mirroring how the batch toolbar filters its rows by `selectedIds` before
 * handing them to the toolbar.
 */
export function commonIssueFields(issues: readonly Issue[]): CommonIssueFields {
  const status = sharedValue(issues.map((i) => i.status));
  const priority = sharedValue(issues.map((i) => i.priority));

  const sharedAssigneeKey = sharedValue(
    issues.map((i) => assigneeKey(i.assignee_type, i.assignee_id)),
  );
  const assignee =
    sharedAssigneeKey !== null && issues.length > 0
      ? { type: issues[0]!.assignee_type, id: issues[0]!.assignee_id }
      : null;

  return { status, priority, assignee };
}