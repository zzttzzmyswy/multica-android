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
import type { WorkspaceWakeup, WorkspaceWakeupFilters, WakeupScope } from "@multica/core/types";
import type { WakeupTextDeps } from "./wakeup-presentation";
import {
  formatWakeupTime,
  wakeupPausedText,
  wakeupTrigger,
  wakeupRunStateText,
} from "./wakeup-presentation";

/** The five scopes, in web's display order. */
export const WORKSPACE_WAKEUP_SCOPES = [
  "active",
  "paused",
  "disabled",
  "ended",
  "all",
] as const;

/** The four SOURCES the filter offers, `""` meaning "every source". */
export const WORKSPACE_WAKEUP_SOURCES = [
  "",
  "member",
  "agent",
  "system",
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

// ---------------------------------------------------------------------------
// The names the table's controller and rows read.
//
// Several of the predicates above are spelled the way WEB spells them
// (`workspaceWakeupsAreFiltered`, `workspaceWakeupSelectionState`); the
// controller calls the shape this app's other list surfaces use. Rather than
// rename one side and re-test it, the web-named implementation stays the single
// source of truth and these are thin, documented aliases over it — so a reader
// looking for the behaviour has exactly one body to find.
// ---------------------------------------------------------------------------

/** The neutral window a fresh visit starts from, web's initial state. Same
 *  object `emptyWorkspaceWakeupFilters()` builds; the controller wants a
 *  constant it can spread when clearing. */
export const EMPTY_WORKSPACE_WAKEUP_FILTERS: WorkspaceWakeupFilters =
  emptyWorkspaceWakeupFilters();

/** The filters a first visit starts from, with the first page's window. */
export const FIRST_WORKSPACE_WAKEUP_PAGE: WorkspaceWakeupFilters =
  emptyWorkspaceWakeupFilters();

/** Whether anything narrows the current result set. See
 *  `workspaceWakeupsAreFiltered` for why the default `active` scope counts. */
export const isWorkspaceWakeupFiltered = workspaceWakeupsAreFiltered;

/** The 1-based page number, for the results line. */
export function workspaceWakeupPageNumber(
  offset: number,
  limit = WORKSPACE_WAKEUP_PAGE_SIZE,
): number {
  return workspaceWakeupPage(offset, limit);
}

/**
 * The offset "next" lands on, or `null` when there is no next page.
 *
 * Returning `null` rather than an out-of-range offset is what lets the pager
 * button be `disabled={nextOffset === null}` instead of re-deriving the
 * end-of-list test at the call site — the same reason `enableRevision` is
 * returned as a value in `lib/wakeup-controls.ts` rather than recomputed.
 */
export function nextWorkspaceWakeupOffset(
  offset: number,
  total: number,
  limit = WORKSPACE_WAKEUP_PAGE_SIZE,
): number | null {
  const { hasNext } = workspaceWakeupPager({ offset, limit, total });
  return hasNext ? offset + limit : null;
}

/** The offset "previous" lands on, or `null` on the first page. */
export function previousWorkspaceWakeupOffset(
  offset: number,
  limit = WORKSPACE_WAKEUP_PAGE_SIZE,
): number | null {
  const { hasPrevious } = workspaceWakeupPager({
    offset,
    limit,
    total: Number.MAX_SAFE_INTEGER,
  });
  return hasPrevious ? Math.max(0, offset - limit) : null;
}

/** Whether a row may be put in a batch selection. */
export const workspaceWakeupSelectable = canSelectWorkspaceWakeup;

/** Toggle one id in a selection, immutably. */
export function toggleWorkspaceWakeupSelection(
  selected: ReadonlySet<string>,
  id: string,
): ReadonlySet<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The selection set, folded into the three facts the table's chrome needs. */
export interface WorkspaceWakeupSelection {
  /** The selectable rows on this page the user has ticked. */
  picked: WorkspaceWakeup[];
  /** Any row is ticked, so the checkboxes are visible. */
  selecting: boolean;
  allSelected: boolean;
  someSelected: boolean;
}

/**
 * Fold a raw id set against the page on screen.
 *
 * Reconciled against the ROWS, not carried as-is, because a filter change can
 * leave an id selected that is no longer on the page — the footer would then
 * report "3 selected" with nothing ticked anywhere, and the batch would act on
 * a rule the user cannot see. Every id that survives is one the current page
 * still shows.
 */
export function workspaceWakeupSelection(
  rows: readonly WorkspaceWakeup[],
  selected: ReadonlySet<string>,
): WorkspaceWakeupSelection {
  const selectable = selectableWorkspaceWakeups(rows);
  const picked = selectable.filter((row) => selected.has(row.id));
  const state = workspaceWakeupSelectionState(selectable, selected);
  return {
    picked,
    selecting: picked.length > 0,
    allSelected: state === "all",
    someSelected: state === "some",
  };
}

/** Why a row's own switch is inert, in the vocabulary the row renders. `null`
 *  means it is live. */
export type WorkspaceWakeupRowBlock = "read_only" | "closed" | null;

/**
 * Whether a row's switch may be pressed, and if not, why.
 *
 * Two distinct refusals, and they read differently to the user, which is why
 * they are not collapsed into one boolean:
 *   - `read_only` — the server refuses this reader's write at all
 *     (`can_manage` false: neither the creator nor a workspace admin).
 *   - `closed` — the issue is finished, so the server refuses to enable a rule
 *     on it. The row says so with `wakeups.closedHint`, the same line the
 *     issue-level section prints.
 *
 * `pending` wins over both: while a batch is in flight every row's switch is
 * inert, and saying "read only" then would be a lie about a permission.
 */
export function workspaceWakeupRowBlock({
  row,
  pending,
}: {
  row: WorkspaceWakeup;
  pending: boolean;
}): WorkspaceWakeupRowBlock {
  if (pending) return "read_only";
  if (!row.can_manage) return "read_only";
  if (row.issue_closed) return "closed";
  return null;
}

/** What the rule's trigger line says — web's `TriggerCell`. */
export function workspaceWakeupTriggerText(
  deps: WakeupTextDeps,
  row: WorkspaceWakeup,
): string {
  return wakeupTrigger(deps, row);
}

/**
 * The line under the trigger: the rule's cadence and its schedule.
 *
 * Web puts these in the same cell as a `title` attribute (a phone has no
 * hover) and adds the timezone for a cron. Kept separate from the trigger so
 * the row can show one line and the sheet the other.
 */
export function workspaceWakeupTriggerDetail(
  deps: WakeupTextDeps,
  row: WorkspaceWakeup,
): string | null {
  const { t } = deps;
  if (row.kind === "every" && row.interval_seconds != null) {
    return t("wakeups.everySeconds", { seconds: row.interval_seconds });
  }
  if (row.kind === "cron" && row.cron_expression) {
    return `${row.cron_expression} · ${row.timezone}`;
  }
  if (row.kind === "at" && row.next_fire_at) {
    return formatWakeupTime(row.next_fire_at);
  }
  return row.mode === "continuous" ? t("wakeups.continuous") : t("wakeups.once");
}

/**
 * The 有效期 cell: when the rule stops, as one sentence.
 *
 * Web's branch order, kept exactly (`workspace-wakeups.tsx` `ends`): an
 * ENABLED rule reads as when it will end (its expiry, or "until the issue
 * ends" for a system rule), and anything else reads as its lifecycle state —
 * because "when does this stop" is only a live question while it is running.
 * A paused rule prefers its paused reason, which is the one state a reader has
 * to act on.
 */
export function workspaceWakeupEndsText(
  deps: WakeupTextDeps,
  row: WorkspaceWakeup,
): string {
  const { t } = deps;
  if (row.source === "system") return t("autopilots.wakeups.until_issue_ends");
  if (!row.enabled) {
    const paused = wakeupPausedText(deps, row);
    if (paused) return paused;
    return t(`wakeups.ruleStates.${row.issue_closed ? "issue_closed" : stateKeyOf(row)}`);
  }
  if (row.expires_at) {
    return row.kind === "event" || row.expiry_seconds
      ? remainingText(deps, row.expires_at)
      : t("wakeups.untilDate", { date: shortDate(row.expires_at) });
  }
  return row.mode === "once"
    ? t("autopilots.wakeups.fires_once")
    : t("wakeups.ruleStates.waiting");
}

/** The lifecycle key for an enabled rule, which reads as "waiting"/"scheduled". */
function stateKeyOf(row: WorkspaceWakeup): string {
  return row.kind === "event" ? "waiting" : "scheduled";
}

/** "In 3 days" / "in 4 hours", or the date once it has passed. */
function remainingText(deps: WakeupTextDeps, value: string): string {
  const ms = Date.parse(value) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return deps.t("wakeups.ruleStates.expired");
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const days = Math.floor(ms / day);
  const hours = Math.floor((ms % day) / hour);
  if (days >= 3) return deps.t("wakeups.remainingDays", { days });
  if (days >= 1)
    return deps.t("wakeups.remainingDaysHours", { days, hours });
  if (hours >= 1) return deps.t("wakeups.remainingHours", { hours });
  return deps.t("wakeups.remainingMinutes", {
    minutes: Math.max(1, Math.ceil(ms / minute)),
  });
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

/** A rule's latest run state, or null when it has none. */
export function workspaceWakeupRunState(
  deps: WakeupTextDeps,
  row: WorkspaceWakeup,
): string | null {
  return row.task ? wakeupRunStateText(deps, row.task.status) : null;
}

/**
 * The banner over the table, or null when nothing is paused.
 *
 * Web shows it only when the `paused` count is non-zero AND the reader is not
 * already looking at the paused scope — the banner's whole purpose is to say
 * "there is something you have not seen", which is false once you are looking
 * at it. It names the newest paused rule, which is why the caller fetches one
 * paused row separately rather than reusing the current page (the current page
 * is whatever scope the reader chose).
 */
export function workspaceWakeupBanner(
  deps: WakeupTextDeps,
  filters: WorkspaceWakeupFilters,
  counts: Record<WakeupScope, number>,
  latest: WorkspaceWakeup | undefined,
): { count: number; issue: string; condition: string; reason: string } | null {
  if (!counts.paused || !latest || filters.scope === "paused") return null;
  return {
    count: counts.paused,
    issue: latest.issue_identifier,
    condition: workspaceWakeupTriggerText(deps, latest),
    reason: wakeupPausedText(deps, latest) ?? "",
  };
}

/**
 * The post-batch line, or null when no batch has run.
 *
 * A separate function from `workspaceWakeupBatchOutcome` because the two answer
 * different questions: that one decides what a result MEANS (and which ids stay
 * selected), this one produces the sentence the footer prints. Keeping them
 * apart is what lets the outcome — the must-agree part with web — be tested
 * without a translator.
 */
export function workspaceWakeupBatchMessage(
  result: WorkspaceWakeupBatchResult | null,
): { key: string; params: Record<string, number> } | null {
  if (!result) return null;
  const outcome = workspaceWakeupBatchOutcome(result);
  return { key: outcome.key, params: outcome.params };
}
