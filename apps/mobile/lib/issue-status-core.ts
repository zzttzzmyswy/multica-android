/**
 * Pure status-order constants for the issue list / board / swimlane surfaces.
 *
 * Split out of `./issue-status` (which pulls i18n → expo → react-native) so
 * the Node vitest lane can import the REAL constant rather than inlining a
 * copy that silently drifts. Same reason `./status-options-core` exists.
 *
 * Mirrored, not imported: `@multica/core/issues/config/status` co-exports
 * `STATUS_CONFIG` with web colour tokens (Tailwind v4 syntax) that mobile must
 * not pull into its bundle. `issue-status-core.test.ts` imports both sides and
 * asserts they are equal, so the mirror cannot drift unnoticed.
 */
import type { IssueStatusCategory } from "@multica/core/types";

/**
 * Board columns / list sections, in canonical lifecycle order.
 *
 * These are CATEGORIES, not status keys (MUL-6243): a workspace may define any
 * number of custom statuses, but every one folds into one of these columns via
 * its category. `groupIssues` buckets through the catalog's category resolver
 * before mapping onto this order.
 *
 * `cancelled` is a first-class member (MUL-4290), ordered last exactly as web
 * orders it. Every other mobile surface already carried it — the status filter
 * and picker offer it (`status-options-core`), the table view groups by it
 * (`issue-table-groups`), the persisted view codec accepts it
 * (`issue-view-codec`) — so omitting it here was the one place a cancelled
 * issue had nowhere to render. Selecting "Cancelled" in the filter matched
 * rows server-side and then drew an empty list.
 */
export const BOARD_STATUSES: IssueStatusCategory[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
];
