/**
 * The decisions the workspace-wide wakeup table reads (MYS-2043).
 *
 * Why this is a separate pure module and not logic inside the screen: the
 * mobile vitest lane is Node-only (`vitest.config.ts` — no RN renderer), so a
 * decision buried in JSX cannot be tested at all. That is the same reason
 * `lib/wakeup-controls.ts` and `lib/wakeup-presentation.ts` exist.
 *
 * It is also this round's must-agree point with web
 * (`packages/views/autopilots/components/workspace-wakeups.tsx`): given the
 * same page of rows and the same filters, the two clients must agree on WHICH
 * rows are selectable, whether a batch can run, and what a batch result means.
 * Those three are where a divergence would be a real defect rather than a
 * layout difference — a phone that offers "turn off selected" for a row the
 * server will refuse, or that reports a partial failure as a success, is
 * lying to the user about what happened.
 */
import type { WorkspaceWakeup, WorkspaceWakeupFilters } from "@multica/core/types";

/** The five scopes, in web's display order. */
export const WORKSPACE_WAKEUP_SCOPES = [
  "active",
  "paused",
  "disabled",
  "ended",
  "all",
] as const;

/** The four trigger filters, in web's order. */
export const WORKSPACE_WAKEUP_KINDS = [
  "all",
  "event",
  "at",
  "recurring",
] as const;

/**
 * The `recurring` trigger the filter offers is NOT the `kind` the wire carries.
 *
 * The server's `kind` enum is `event | at | every | cron`; the table's filter is
 * `all | event | at | recurring`, and `recurring` is the umbrella the server
 * folds `every` and `cron` into. Verified live: `kind=recurring` answers 200
 * with rows whose kinds are exactly `["cron", "every"]`. A client that sent
 * `every` would be sending a value the server does not accept
 * (`invalid wakeup kind`), and one that filtered `every || cron` client-side
 * would only ever see the rows on the current page. So the mapping lives here,
 * at the one place that builds a request, rather than at a call site.
 */
export type WorkspaceWakeupKindFilter = (typeof WORKSPACE_WAKEUP_KINDS)[number];

/** The page size the phone asks for. Web uses 50 on a wide table; a phone
 *  shows one row per ~72px, so a page that fits a desktop viewport is three
 *  screens here. 20 keeps a page a page, and the server's own ceiling is 100
 *  (`invalid pagination` outside 1…100). */
export const WORKSPACE_WAKEUP_PAGE_SIZE = 20;

/**
 * The server's search ceiling, in BYTES.
 *
 * Web caps its input with `maxLength={256}`, which is a CHARACTER cap — so a
 * Chinese search can be 768 bytes and the server answers
 * `400 search too long`. Measured live: 85 CJK characters (255 bytes) is
 * accepted, 100 CJK characters (300 bytes) is refused, and 257 ASCII bytes is
 * refused. The cap that matters on the wire is bytes, so it is spelled in
 * bytes here and the field enforces it.
 */
export const WORKSPACE_WAKEUP_SEARCH_MAX_BYTES = 256;

/** The filters a fresh visit to the table starts from. Web's initial state:
 *  the `active` scope, every other dimension open. */
export function emptyWorkspaceWakeupFilters(): WorkspaceWakeupFilters {
  return {
    scope: "active",
    kind: "all",
    source: "",
    search: "",
    agent_id: "",
    offset: 0,
    limit: WORKSPACE_WAKEUP_PAGE_SIZE,
  };
}

/**
 * Whether ANY dimension narrows the current result set.
 *
 * Web's `filtered` (workspace-wakeups.tsx): everything except `all`-scope, the
 * `all`-kind, an empty source, an empty agent and an empty search. It decides
 * which empty state the table shows — "no rules at all" versus "no rule matched
 * these filters, clear them" — so it has to agree with the server's answer, not
 * with what the user typed.
 *
 * `offset`/`limit` are deliberately NOT part of this: paging moves through one
 * result set, it does not narrow it, and counting them would relabel a
 * paged-to-the-end view as "filtered".
 */
export function workspaceWakeupsAreFiltered(
  filters: WorkspaceWakeupFilters,
): boolean {
  return (
    filters.scope !== "all" ||
    filters.kind !== "all" ||
    !!filters.source ||
    !!filters.agent_id ||
    !!filters.search
  );
}

/** How many filter dimensions are active, for the filter chip's badge. Counts
 *  the four narrowing dimensions and NOT the scope, which has its own control
 *  on screen — a badge that counted the scope too would read "1" on first
 *  visit. */
export function countWorkspaceWakeupFilters(
  filters: WorkspaceWakeupFilters,
): number {
  return (
    (filters.kind !== "all" ? 1 : 0) +
    (filters.source ? 1 : 0) +
    (filters.agent_id ? 1 : 0) +
    (filters.search ? 1 : 0)
  );
}

/**
 * Whether a row may be put in a batch "turn off" selection.
 *
 * Web's `selectable`, unchanged, and every clause is a distinct server
 * refusal:
 *   - `enabled` — disabling an already-off rule is a no-op write; the server
 *     accepts it and nothing changes, so offering the checkbox would produce a
 *     batch that reports success without having done anything.
 *   - `can_manage` — the server refuses the write for a rule this reader
 *     neither created nor administers. Offering it would turn a permission
 *     fact into a failed request.
 *   - `source !== "system"` — a platform rule is toggled through its own
 *     per-issue endpoint (`PUT /api/issues/:id/system-wakeups/:rule`), not
 *     through `disableIssueWakeup`, which takes a rule id that a system row
 *     does not have (its `id` is the ISSUE's id). Selecting one would send a
 *     disable for an id that names no rule.
 */
export function canSelectWorkspaceWakeup(row: WorkspaceWakeup): boolean {
  return row.enabled && row.can_manage && row.source !== "system";
}

/** The rows a "select all" would take: the selectable ones on this page. */
export function selectableWorkspaceWakeups(
  rows: readonly WorkspaceWakeup[],
): WorkspaceWakeup[] {
  return rows.filter(canSelectWorkspaceWakeup);
}

/**
 * Whether the page-level "select all" box reads checked, indeterminate, or
 * empty — derived from the selection rather than stored, so it cannot drift
 * from the rows on screen after a page change.
 *
 * `"none"` when either set is empty is deliberate: with no selectable row the
 * box is disabled and unchecked, and a selection left over from a previous
 * page must not make it read as partially checked against a page that has
 * nothing to select.
 */
export function workspaceWakeupSelectionState(
  selectable: readonly WorkspaceWakeup[],
  selected: ReadonlySet<string>,
): "none" | "some" | "all" {
  const picked = selectable.filter((row) => selected.has(row.id));
  if (!picked.length || !selectable.length) return "none";
  return picked.length === selectable.length ? "all" : "some";
}

/**
 * What a finished batch did, in the shape the result line needs.
 *
 * Web's mutation returns `{failed, succeeded}` where `failed` is a list of rule
 * ids and `succeeded` a count. Both halves are load-bearing: the count is what
 * the user is told, and the id list is what stays SELECTED so a retry is one
 * tap. A batch that reported only the count would leave the user to re-find the
 * failures by hand on a workspace with 136 rules.
 */
export interface WorkspaceWakeupBatchResult {
  failed: string[];
  succeeded: number;
}

/**
 * Fold a batch's outcome into the line to show, and whether it is a failure.
 *
 * The partial case is reported as a failure (`tone: "destructive"`), which is
 * web's own reading (`batchResult.failed.length ? destructive : muted`): "12 of
 * 15 turned off" is not good news the user may skim past, because the three
 * that did not are still going to wake an agent.
 */
export function workspaceWakeupBatchOutcome(
  result: WorkspaceWakeupBatchResult,
): {
  /** i18n id for the line. */
  key: string;
  /** Params for that id, with both count spellings web's ICU strings expect. */
  params: Record<string, number>;
  /** Whether the line is a failure report. */
  tone: "muted" | "destructive";
  /** Ids to leave selected, so a retry is one tap. */
  keepSelected: string[];
} {
  const failed = result.failed.length;
  if (failed) {
    return {
      key: "autopilots.wakeups.batch_partial",
      params: { succeeded: result.succeeded, failed, count: result.succeeded },
      tone: "destructive",
      keepSelected: result.failed,
    };
  }
  return {
    key: "autopilots.wakeups.batch_success",
    params: { count: result.succeeded, succeeded: result.succeeded, failed: 0 },
    tone: "muted",
    keepSelected: [],
  };
}

/**
 * Whether a batch may be started right now.
 *
 * An empty selection is the whole check: web gates its confirm button on
 * `batch.isPending` alone and the button only exists when `picked.length > 0`,
 * so the two conditions are "something is selected" and "nothing is in
 * flight". A pending batch must not be re-enterable — the sequential write
 * loop would interleave two runs over overlapping ids and report each half of
 * the other's results.
 */
export function canRunWorkspaceWakeupBatch(
  selectedCount: number,
  pending: boolean,
): boolean {
  return selectedCount > 0 && !pending;
}

/** The 1-based page number `offset` sits on, for the results line. */
export function workspaceWakeupPage(
  offset: number,
  limit = WORKSPACE_WAKEUP_PAGE_SIZE,
): number {
  if (limit <= 0) return 1;
  return Math.floor(Math.max(0, offset) / limit) + 1;
}

/**
 * Whether there is a page in each direction.
 *
 * `total` is the server's filtered count, not the page length, so "next" is
 * exactly "the page after this one still has a row in it" — the same test web
 * makes (`offset + limit >= total` disables it). Paging past the end would
 * render an empty table on a query that has rows, which reads as data loss.
 */
export function workspaceWakeupPager({
  offset,
  limit,
  total,
}: {
  offset: number;
  limit: number;
  total: number;
}): { hasPrevious: boolean; hasNext: boolean } {
  return {
    hasPrevious: offset > 0,
    hasNext: offset + limit < total,
  };
}

/** The offset a "previous" tap lands on, floored at 0. */
export function previousWorkspaceWakeupOffset(
  offset: number,
  limit = WORKSPACE_WAKEUP_PAGE_SIZE,
): number {
  return Math.max(0, offset - limit);
}

/**
 * Whether the reader's search text must be shortened before it is sent.
 *
 * The field enforces the byte cap as the user types, so this is the belt to
 * that braces: it is what a submit path checks, and it is what makes the rule
 * testable at all. Returning the byte count rather than a boolean lets the
 * caller show the limit the way the other byte-capped fields in this app do.
 */
export function workspaceWakeupSearchBytes(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Whether `text` fits the server's search cap. */
export function workspaceWakeupSearchFits(text: string): boolean {
  return (
    workspaceWakeupSearchBytes(text) <= WORKSPACE_WAKEUP_SEARCH_MAX_BYTES
  );
}

/**
 * Trim a search string to the byte cap on a code-point boundary.
 *
 * Used by the input's onChange so the field cannot hold a value the server
 * would refuse. It is a byte truncation rather than a character cap precisely
 * because `maxLength` is not available as a byte cap on a React Native
 * `TextInput` — and char-truncating at 256 would let a Chinese search reach 768
 * bytes and read "search too long" for text the user watched the field accept.
 */
export function clampWorkspaceWakeupSearch(text: string): string {
  if (workspaceWakeupSearchFits(text)) return text;
  let out = "";
  let bytes = 0;
  for (const char of text) {
    const size = workspaceWakeupSearchBytes(char);
    if (bytes + size > WORKSPACE_WAKEUP_SEARCH_MAX_BYTES) break;
    out += char;
    bytes += size;
  }
  return out;
}

/**
 * Every cache key a workspace wakeup WRITE can have made stale, as prefixes.
 *
 * Web's `useDisableWorkspaceWakeups.onSettled` invalidates five families; three
 * of them (`workspace-wakeups`, `issue-wakeup-summaries`, `issue-wakeup-paused`)
 * are keys this fork does not have, so what remains is the table's own key, the
 * per-issue rule lists the same rules appear in, and the TASKS of every issue
 * whose rule was touched. The last one is the easy miss: a rule's row reads its
 * run state from its task, so a batch that cancelled runs without clearing
 * `tasks` leaves the affected issues showing "running" for runs that were just
 * withdrawn.
 *
 * Returned as data rather than performed here so the invalidation set is
 * assertable in the Node lane, where there is no QueryClient to hand a real
 * `invalidateQueries`.
 */
export function workspaceWakeupInvalidationKeys(
  touchedIssueIds: readonly string[],
): { table: true; issueWakeups: true; taskIssueIds: string[] } {
  return {
    table: true,
    issueWakeups: true,
    // De-duplicated: a batch can touch several rules on ONE issue, and the
    // per-issue task key would otherwise be invalidated once per rule.
    taskIssueIds: Array.from(new Set(touchedIssueIds)),
  };
}
