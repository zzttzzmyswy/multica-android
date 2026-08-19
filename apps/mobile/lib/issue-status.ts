/**
 * Mirror of the BOARD_STATUSES order + status labels from
 * packages/core/issues/config/status.ts.
 *
 * Mirrored, not imported: the source file co-exports `STATUS_CONFIG` with
 * web colour tokens (Tailwind v4 syntax) that mobile must not pull in.
 * Keeping this list owned by mobile keeps the import boundary clean.
 *
 * If web ever reorders BOARD_STATUSES or adds/removes a status, this file
 * must be updated to keep the "Counts and visibility must agree" rule
 * (apps/mobile/CLAUDE.md) intact.
 */
import type { IssuePriority, IssueStatus, IssueStatusCategory } from "@multica/core/types";
import { translate } from "./i18n";

/**
 * Statuses surfaced in list/board views (matches web — `cancelled` excluded).
 *
 * Board columns / list sections are CATEGORIES, not status keys (MUL-6243):
 * a workspace may define any number of custom statuses, but every one folds
 * into one of these columns via its category. `groupIssues` mirrors this by
 * bucketing through the catalog's category resolver before mapping onto this
 * order.
 */
export const BOARD_STATUSES: IssueStatusCategory[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
];

export const STATUS_LABEL: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  blocked: "Blocked",
  cancelled: "Cancelled",
};

export const PRIORITY_LABEL: Record<IssuePriority, string> = {
  none: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

/**
 * Localized status label for an issue status value. Falls back to the
 * canonical English map when the dictionary key is missing (unknown future
 * enum value or a bilingual key gap), so enum drift degrades to English
 * rather than exposing the raw wire id.
 */
export function issueStatusLabel(value: string): string {
  const id = `enum.status.${value}`;
  const localized = translate(id);
  return localized === id ? (STATUS_LABEL as Record<string, string>)[value] ?? value : localized;
}

/** Localized priority label, same fallback strategy as `issueStatusLabel`. */
export function issuePriorityLabel(value: string): string {
  const id = `enum.priority.${value}`;
  const localized = translate(id);
  return localized === id ? (PRIORITY_LABEL as Record<string, string>)[value] ?? value : localized;
}
