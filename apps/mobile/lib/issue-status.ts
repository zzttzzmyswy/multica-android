/**
 * Localized status / priority labels for mobile.
 *
 * The board column order that used to live here now lives in
 * `./issue-status-core` — a module with no i18n/expo import, so the vitest
 * lane can compare the real constant against
 * `packages/core/issues/config/status`'s `STATUS_ORDER` instead of inlining a
 * copy that drifts. Consumers import it from there directly, so there is no
 * re-export here to fall out of step with it.
 */
import type { IssuePriority, IssueStatus } from "@multica/core/types";
import { translate } from "./i18n";

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
