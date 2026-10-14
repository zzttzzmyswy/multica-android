/**
 * Server-cursor "Export all" for the table view (MYS-2157 / iter 241).
 *
 * The defect this closes: mobile's "Export all" serialized the rows the surface
 * had *already loaded*. Two consequences, both measured on the live deployment
 * (2077-row workspace):
 *
 *   1. **It could refuse outright.** Completeness was judged from the client
 *      window's fetch state (`issue-table-export-completeness.ts`, now deleted):
 *      while the aggregate views' best-effort drain was still running the export
 *      was blocked, and after one failed page it was blocked *forever* — even
 *      though the server could answer the same question in one walk.
 *   2. **It cost twice the requests.** The window is paged by
 *      `GET /api/issues?limit=50&offset=…`, so the walk took **42** requests.
 *      The rows endpoint pages at 100 by cursor: **21**, for the same 2077 ids.
 *
 * Web never asked the client window at all. `exportTableIssues`
 * (`packages/views/issues/surface/use-issue-surface-controller.ts:715`) walks
 * `POST /api/issues/table/rows` with `limit: 100` + `cursor` and asserts the
 * response's own completeness markers on every page. This module is that walk,
 * minus React: `fetchPage` is injected, so the Node vitest lane covers every
 * branch AND counts the requests the walk actually issues.
 *
 * ## Why the server's markers are the completeness proof
 *
 * `query_fingerprint` is the server's hash of the query it answered. A
 * fingerprint that changes between pages means the pages belong to different
 * result sets — the walk is no longer describing one collection, so it must not
 * produce a file. `group_key` / `parent_id` must stay null because the export
 * asks for the FLAT result set (`group: {kind: "none"}`, `hierarchy.enabled:
 * false`); a non-null value means the server answered a different question than
 * the one asked. `total` is authoritative on the FIRST page only — later pages
 * report 0 (measured: 2077 then 0, 0, …), so comparing `rows.length` against a
 * later page's total would read the true count as an empty result set.
 *
 * ## The one bound mobile keeps that web does not
 *
 * `maxRows` refuses a result set the phone has no business materializing. The
 * number is the same 10 000 the aggregate views' drain already stops at
 * (`DRAIN_MAX_ROWS`), so the product-level ceiling is unchanged — only its
 * *reason* is: it is now a single pre-flight check on the first page's `total`
 * rather than a truncated walk that could not tell you what it had missed.
 */
import type {
  Issue,
  IssueTableQuerySpec,
  IssueTableRowsResponse,
  IssueTableScope,
} from "@multica/core/types";
import type { IssueCountWindowParams } from "@/data/queries/issue-keys";
import type {
  IssueSortDirection,
  IssueSortField,
} from "@/data/stores/issue-filter-slice";
import { buildIssueTableGroupQuerySpec } from "./issue-table-group-counts";

/**
 * Rows per request. The server rejects anything above 100 (`page.limit must be
 * between 1 and 100` — measured on the live deployment for 101 / 150 / 200),
 * and 100 is what web sends. Kept as a named constant so the boundary is
 * asserted once instead of being a literal at both the walk and its test.
 */
export const ISSUE_TABLE_EXPORT_PAGE_LIMIT = 100;

/**
 * Rows a phone-side export is willing to materialize. Equal to the aggregate
 * views' drain cap by design: the ceiling is a product decision that this
 * change does not move, only re-checks earlier and honestly.
 */
export const ISSUE_TABLE_EXPORT_MAX_ROWS = 10_000;

/**
 * The Table query spec the export walks.
 *
 * The FILTERS bag is not rebuilt here — it comes from
 * `buildIssueTableGroupQuerySpec`, the one projection mobile already uses for
 * its server group counts and facets, so the exported result set cannot drift
 * from the counted one. Two dimensions are layered on top, both because the
 * *count* channel deliberately drops them and neither omission is acceptable for
 * an export:
 *
 *   - `search` — `IssueCountWindowParams.q` IS the Table quick search (the
 *     surfaces build their window with `tableSearch: debouncedTableSearch`), but
 *     the count projection never maps it onto the spec because a count of the
 *     searched set is not what group headers show. Rows DO narrow by it, so an
 *     export that dropped it would hand back the whole workspace under a
 *     searched table.
 *   - `sort` — the count projection pins `position/asc` on purpose ("counts are
 *     sort-invariant"). A row ORDER is part of what the user sees in the CSV, so
 *     the export carries the table's live sort, exactly as web's `tableQuerySpec`
 *     does.
 *
 * The search is read from `window.q` rather than from the surface's raw search
 * state: `window` is the debounced value the rows were actually fetched with, so
 * reading the in-flight input instead would export a set the table is not
 * showing.
 */
export function buildIssueTableExportQuerySpec(
  scope: IssueTableScope,
  window: IssueCountWindowParams,
  includeSubIssues: boolean,
  sort: { field: IssueSortField; direction: IssueSortDirection },
): IssueTableQuerySpec {
  const search = window.q?.trim();
  return {
    ...buildIssueTableGroupQuerySpec(scope, window, includeSubIssues),
    ...(search ? { search } : {}),
    sort: { field: sort.field, direction: sort.direction },
  };
}

/**
 * Why a walk failed to prove the collection is complete. Each is a distinct
 * server-side contradiction, kept apart so the failure is diagnosable in logs
 * (and testable) while the user sees one actionable message.
 */
export type IssueTableExportIntegrityFailure =
  | "fingerprint_missing"
  | "fingerprint_changed"
  | "scope_drift"
  | "duplicate_row"
  | "cursor_loop"
  | "row_count_mismatch";

/**
 * Export must fail closed when the paged responses cannot prove that the
 * complete result set was collected. Mirrors web's marker of the same name
 * (`packages/views/issues/components/table-view-model.ts:14`): a truncated CSV
 * that looks successful is worse than no CSV, so the caller translates this into
 * a distinguishable message instead of shipping a partial file.
 */
export class IssueTableExportIntegrityError extends Error {
  readonly failure: IssueTableExportIntegrityFailure;

  constructor(failure: IssueTableExportIntegrityFailure) {
    super(`Table export response was incomplete (${failure})`);
    this.name = "IssueTableExportIntegrityError";
    this.failure = failure;
  }
}

/**
 * The result set is larger than the phone-side ceiling. Separate from the
 * integrity error because the user's action differs: nothing is wrong with the
 * response, the export is simply too big to build here — the same message the
 * drain-era row ceiling already showed.
 */
export class IssueTableExportTooLargeError extends Error {
  readonly total: number;

  constructor(total: number) {
    super(`Table export result set is too large (${total} rows)`);
    this.name = "IssueTableExportTooLargeError";
    this.total = total;
  }
}

/** What one complete walk produced. `requests` is the walk's own count of the
 *  pages it fetched — the observable the request-count claim is judged on. */
export interface IssueTableExportResult {
  rows: Issue[];
  /** Pages fetched, i.e. HTTP requests issued. `ceil(total / limit)`. */
  requests: number;
  /** The first page's `total`, which the walk asserted equals `rows.length`. */
  total: number;
  /** The `query_fingerprint` every page agreed on. */
  fingerprint: string;
}

/** The subset of a rows response the walk reads. Declared structurally so a test
 *  can serve a page without constructing a full `IssueTableRowsResponse`. */
export interface IssueTableExportPage {
  query_fingerprint: string;
  group_key: string | null;
  parent_id: string | null;
  total: number;
  rows: readonly { issue: Issue }[];
  next_cursor: string | null;
}

/**
 * Validate one page against the walk's running state, returning the rows it
 * contributed.
 *
 * `expectedFingerprint` is null on the first page. Check order is deliberate: the
 * fingerprint checks come first because they invalidate the whole collection,
 * and the duplicate check runs before the row is appended so `seenIssueIds`
 * never holds an id it just rejected.
 */
export function acceptExportPage(
  page: IssueTableExportPage,
  expectedFingerprint: string | null,
  seenIssueIds: Set<string>,
): Issue[] {
  // An empty fingerprint is the schema fallback's sentinel: a drifted response
  // parses to the EMPTY response, which must never look like a real page.
  if (!page.query_fingerprint) {
    throw new IssueTableExportIntegrityError("fingerprint_missing");
  }
  if (
    expectedFingerprint !== null &&
    page.query_fingerprint !== expectedFingerprint
  ) {
    throw new IssueTableExportIntegrityError("fingerprint_changed");
  }
  if (page.group_key !== null || page.parent_id !== null) {
    throw new IssueTableExportIntegrityError("scope_drift");
  }
  const addedRows: Issue[] = [];
  for (const row of page.rows) {
    if (seenIssueIds.has(row.issue.id)) {
      throw new IssueTableExportIntegrityError("duplicate_row");
    }
    seenIssueIds.add(row.issue.id);
    addedRows.push(row.issue);
  }
  return addedRows;
}

/**
 * Walk every page of the flat result set and return the rows, or throw.
 *
 * `fetchPage` receives the cursor (`null` for the first page) and must issue the
 * request; the walk never builds one itself, which is what makes the request
 * count observable from a test. Cursors are remembered: a server handing back a
 * cursor it already sent would otherwise spin forever, and "the walk never
 * terminates" is a worse failure on a phone than "the export was cancelled".
 *
 * The final assertion is against the FIRST page's `total` — see the module doc
 * for why later pages cannot supply it.
 */
export async function collectIssueTableExportRows(
  fetchPage: (cursor: string | null) => Promise<IssueTableRowsResponse>,
  options: { maxRows?: number } = {},
): Promise<IssueTableExportResult> {
  const maxRows = options.maxRows ?? ISSUE_TABLE_EXPORT_MAX_ROWS;
  const rows: Issue[] = [];
  const seenIssueIds = new Set<string>();
  const seenCursors = new Set<string>();
  let fingerprint: string | null = null;
  let expectedTotal: number | null = null;
  let cursor: string | null = null;
  let requests = 0;

  do {
    if (cursor !== null) {
      if (seenCursors.has(cursor)) {
        throw new IssueTableExportIntegrityError("cursor_loop");
      }
      seenCursors.add(cursor);
    }
    const page = await fetchPage(cursor);
    requests += 1;
    if (expectedTotal === null && page.total > maxRows) {
      // Refuse on the first page's authoritative total, before a single
      // further request: the alternative is downloading the whole set to then
      // discover it cannot be used.
      throw new IssueTableExportTooLargeError(page.total);
    }
    rows.push(...acceptExportPage(page, fingerprint, seenIssueIds));
    fingerprint = page.query_fingerprint;
    if (expectedTotal === null) expectedTotal = page.total;
    cursor = page.next_cursor;
  } while (cursor);

  if (expectedTotal === null || rows.length !== expectedTotal) {
    throw new IssueTableExportIntegrityError("row_count_mismatch");
  }
  return { rows, requests, total: expectedTotal, fingerprint };
}
