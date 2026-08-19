import type { IssueStatusCategory } from "../types";

// Minimal category-resolution helpers (MUL-6243).
//
// This module is deliberately dependency-free: the full upstream
// packages/core/issues/status-category.ts pulls in the issue-statuses catalog
// (queries + api client), which the fork's legacy web surfaces do not want. The
// two pure predicates below cover every presentation lookup those surfaces
// make, and the mobile client mirrors them in apps/mobile/lib instead of
// importing this file (mobile keeps the runtime coupling boundary).

const CATEGORIES = new Set<string>([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
]);

/** True when `value` is one of the 7 built-in status keys (which ARE the
 *  categories). Exact for every status that exists until an admin defines a
 *  custom one. (MUL-6243) */
export function isIssueStatusCategory(
  value: string,
): value is IssueStatusCategory {
  return CATEGORIES.has(value);
}

/**
 * The category a bare status KEY belongs to. Exact for the 7 built-ins; a
 * custom key that no catalog resolved falls back to `todo` so presentation
 * lookups always render something. (MUL-6243)
 */
export function statusCategoryOfKey(
  statusKey: string,
): IssueStatusCategory {
  return isIssueStatusCategory(statusKey) ? statusKey : "todo";
}