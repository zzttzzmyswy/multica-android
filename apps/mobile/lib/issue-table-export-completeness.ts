/**
 * Fail-closed completeness gate for the table view's "Export all" (MYS-2015).
 *
 * Pure decision layer — no React / RN imports, so the Node vitest lane covers
 * every branch. The table component (`components/issue/table-view.tsx`) owns
 * the file writing and the feedback; this module owns the judgement.
 *
 * The defect this closes: mobile's export serialized whatever rows the surface
 * had already loaded. The aggregate views only *drain* the remaining pages on a
 * best-effort basis (`use-drain-issue-pages.ts`), and the export entry point
 * never waited for that drain — so a workspace with 800 issues handed the user
 * a 50-row CSV that looked completely successful. Web fails closed on the same
 * input (`exportTableIssues`, packages/views/issues/surface/
 * use-issue-surface-controller.ts:715) instead of emitting a truncated file.
 *
 * Why this is NOT web's equality check against the server `total`: the rows the
 * table shows are the *client-filtered* window. `applyIssueFilters` narrows by
 * `workingOnly` / `showSubIssues` and the members/agents scope tabs narrow by
 * assignee type, none of which `buildIssueWindow` sends to the server
 * (data/stores/issue-filter-slice.ts:701) — and `issue:deleted` strips rows out
 * of the paginated cache while the cached `total` stays stale
 * (data/realtime/use-issues-realtime.ts:59). So `loaded !== total` is the
 * ordinary state of a filtered table, and an equality assertion would fail
 * every export the moment a filter was on: a false alarm, not a safety net.
 *
 * The fetch state IS provable: `hasNextPage === false` means the server
 * reported the window exhausted (`nextIssuePageParam`, issue-pagination.ts:72).
 * The three blocked reasons below are its failure modes.
 */
import { DRAIN_MAX_ROWS } from "./use-drain-issue-pages";

/** Which row set the user asked to export. */
export type IssueTableExportScope = "all" | "selected";

/**
 * The fetch state of the window the table is showing, as `useInfiniteQuery`
 * reports it. Deliberately the *server* window's state, not the rendered row
 * count: the rows on screen are client-filtered, so only the query can say
 * whether anything is still outstanding.
 */
export interface IssueTableExportWindow {
  /** Another server page exists (`useInfiniteQuery.hasNextPage`). */
  hasNextPage: boolean;
  /** The last page fetch failed; the drain gives up here and never retries. */
  isFetchNextPageError: boolean;
  /** Rows fetched from the server (pre client-filter), for the ceiling test. */
  loadedRows: number;
  /** The drain's hard row cap. Defaults to `DRAIN_MAX_ROWS`, which is what
   *  every surface drains to — only tests pass anything else. */
  maxRows?: number;
}

/**
 * Why an "Export all" cannot be proven complete. Each maps to its own message
 * (`exportBlockedMessageKey`) because the three need different user actions.
 */
export type IssueTableExportBlockedReason =
  | "draining"
  | "drainFailed"
  | "rowCeiling";

/**
 * Export must fail closed when the paged window cannot prove it was collected
 * in full. Mirrors web's marker of the same name
 * (packages/views/issues/components/table-view-model.ts:14): the UI translates
 * this marker instead of exposing a protocol detail to the user.
 */
export class IssueTableExportIntegrityError extends Error {
  constructor(reason?: IssueTableExportBlockedReason) {
    super(
      reason
        ? `Table export blocked: ${reason}`
        : "Table export is incomplete",
    );
    this.name = "IssueTableExportIntegrityError";
  }
}

/**
 * Why this export would be incomplete, or null when it can proceed.
 *
 * `selected` is never constrained: those rows can only come from what is
 * already rendered, so the set is inherently bounded — web applies no
 * completeness assertion to it either.
 *
 * Ordering matters. A failed page is the more actionable diagnosis than the
 * ceiling (retrying can help; the cap cannot be raised from the UI), so it is
 * reported first when both hold.
 */
export function exportBlockedReason(
  scope: IssueTableExportScope,
  window: IssueTableExportWindow,
): IssueTableExportBlockedReason | null {
  if (scope !== "all") return null;
  // The server said the window is exhausted — nothing left to collect.
  if (!window.hasNextPage) return null;
  if (window.isFetchNextPageError) return "drainFailed";
  if (window.loadedRows >= (window.maxRows ?? DRAIN_MAX_ROWS)) {
    return "rowCeiling";
  }
  return "draining";
}

/**
 * Throw unless the window is provably complete. Called immediately before the
 * CSV is built, so an incomplete "all" export can never reach the share sheet —
 * even if a future caller forgets the UI-side pre-check.
 */
export function assertExportComplete(
  scope: IssueTableExportScope,
  window: IssueTableExportWindow,
): void {
  const reason = exportBlockedReason(scope, window);
  if (reason !== null) throw new IssueTableExportIntegrityError(reason);
}

/** i18n key for each blocked reason — the three need different user actions. */
const BLOCKED_MESSAGE_KEYS: Record<IssueTableExportBlockedReason, string> = {
  draining: "table.exportDraining",
  drainFailed: "table.exportDrainFailed",
  rowCeiling: "table.exportRowCeiling",
};

export function exportBlockedMessageKey(
  reason: IssueTableExportBlockedReason,
): string {
  return BLOCKED_MESSAGE_KEYS[reason];
}

/** The cap a real surface passes — re-exported so call sites name one source. */
export const EXPORT_MAX_ROWS = DRAIN_MAX_ROWS;
