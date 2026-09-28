/**
 * Pure derivations for the run-transcript header and its "Run details" panel
 * — the mobile port of web's `agent-transcript-dialog.tsx` header block
 * (`packages/views/common/task-transcript/agent-transcript-dialog.tsx:610-830`).
 *
 * Everything here is a pure function of an `AgentTask` so the label rules stay
 * testable without the native chain, exactly like `lib/task-attribution.ts`.
 *
 * Deliberate divergences from web, each noted at its site:
 *  - the trigger vocabulary is a flat lookup, not web's nested ternary chain;
 *    same precedence, but each branch is named and unit-testable
 *  - web resolves runtime / provider through `api.listRuntimes()` from inside
 *    the dialog. Mobile reads the already-cached runtime list and passes the
 *    three fields in, which keeps these helpers pure and costs no extra
 *    round-trip on cellular.
 */
import type { AgentTask, TaskUsage } from "@multica/core/types";
import { summarizeTaskUsage, type TaskUsageSummary } from "@/lib/task-usage";

/** Statuses whose rows can carry a comment-coverage figure. Mirrors web's
 *  `supportsCommentCoverage` (`execution-log-section.tsx:584-597`) — every
 *  status the vocabulary knows is covered, so the guard exists only so an
 *  unknown future status degrades to "no coverage line" rather than a wrong
 *  count. */
const COVERAGE_STATUSES: ReadonlySet<AgentTask["status"]> = new Set([
  "queued",
  "dispatched",
  "waiting_local_directory",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

/**
 * i18n key for one word answering "why does this run exist".
 *
 * Precedence is web's exactly (`agent-transcript-dialog.tsx:614-626`), and it
 * is a precedence, not a set: a retry that also carries a comment id reads as
 * "Retry". `parent_task_id` wins because the row already tells the reader
 * which issue they are on — that it is a re-attempt is the new information.
 */
export function transcriptTriggerLabelKey(task: AgentTask): string {
  if (task.parent_task_id) return "runs.transcript.triggerRetry";
  if (task.kind === "comment" || task.trigger_comment_id)
    return "runs.transcript.triggerComment";
  if (task.kind === "autopilot" || task.autopilot_run_id)
    return "runs.transcript.triggerAutopilot";
  if (task.kind === "chat" || task.chat_session_id)
    return "runs.transcript.triggerChat";
  if (task.kind === "quick_create") return "runs.transcript.triggerQuickCreate";
  if (task.kind === "direct" || task.handoff_note)
    return "runs.transcript.triggerDirect";
  return "runs.transcript.triggerInitial";
}

/**
 * How many comments this run actually carried, or `null` when there is no
 * figure worth showing.
 *
 * Web's rule (`execution-log-section.tsx:599-625`), including the two
 * subtleties that are easy to get wrong:
 *  - a queued row shows the *plan* (`trigger_comment_id` + `coalesced_*`),
 *    because the delivery receipt does not exist yet; a claimed row prefers
 *    the receipt, and an explicit `[]` receipt means "delivered none" — it
 *    must NOT fall back to the plan
 *  - `<= 1` renders nothing. One comment is the ordinary case and saying
 *    "Includes 1 comment" on every row is noise; the figure exists to flag
 *    the merged runs.
 */
export function commentCoverageCount(task: AgentTask): number | null {
  if (!COVERAGE_STATUSES.has(task.status)) return null;

  const planned = [task.trigger_comment_id, ...(task.coalesced_comment_ids ?? [])];
  const ids =
    task.status !== "queued" && task.delivered_comment_ids !== undefined
      ? task.delivered_comment_ids
      : planned;

  const unique = new Set(ids.filter((id): id is string => Boolean(id)));
  return unique.size > 1 ? unique.size : null;
}

/** One row of the "Run details" panel, already label-keyed and formatted. */
export interface RunDetailRow {
  /** i18n key for the label; the caller resolves it. */
  labelKey: string;
  value: string;
  /** Render in a monospace face and offer copy — paths and refs. */
  mono?: boolean;
}

/**
 * The diagnostics list web hides behind the ⓘ popover
 * (`agent-transcript-dialog.tsx:744-800`), in web's order.
 *
 * Web's branch row is kept conditional on `branch_name` even though the field
 * is absent from this deployment's task payload (verified against
 * `GET /api/issues/:id/task-runs`, where 57/57 runs omit it) — conditional
 * rather than dropped, so an upgraded backend starts showing it with no code
 * change.
 */
export function buildRunDetailRows(input: {
  task: AgentTask;
  /** Cached runtime's provider, already label-resolved by the caller. */
  providerLabel?: string | null;
  /** Cached runtime's mode (`local` / `cloud`). */
  runtimeMode?: string | null;
  /** Cached runtime's display name. */
  runtimeName?: string | null;
  /** ISO formatter for the three timestamps; injected to stay pure. */
  formatTime: (iso: string) => string;
}): RunDetailRow[] {
  const { task, providerLabel, runtimeMode, runtimeName, formatTime } = input;
  const rows: RunDetailRow[] = [];

  if (runtimeName) {
    rows.push({ labelKey: "runs.transcript.detailsRuntime", value: runtimeName });
  }
  if (providerLabel) {
    rows.push({ labelKey: "runs.transcript.detailsProvider", value: providerLabel });
  }
  if (runtimeMode) {
    rows.push({ labelKey: "runs.transcript.detailsMode", value: runtimeMode });
  }
  if (task.relative_work_dir) {
    rows.push({
      labelKey: "runs.transcript.detailsWorkdir",
      value: task.relative_work_dir,
      mono: true,
    });
  }
  if (task.branch_name) {
    rows.push({
      labelKey: "runs.transcript.detailsBranch",
      value: task.branch_name,
      mono: true,
    });
  }
  // The persisted error is the only place "which machine needs upgrading" /
  // "where did my work go" is readable, so it survives on cancelled runs too.
  if (task.error) {
    rows.push({ labelKey: "runs.transcript.detailsReason", value: task.error });
  }
  if (task.created_at) {
    rows.push({ labelKey: "runs.transcript.detailsCreated", value: formatTime(task.created_at) });
  }
  if (task.started_at) {
    rows.push({ labelKey: "runs.transcript.detailsStarted", value: formatTime(task.started_at) });
  }
  if (task.completed_at) {
    rows.push({
      labelKey: "runs.transcript.detailsCompleted",
      value: formatTime(task.completed_at),
    });
  }

  return rows;
}

/**
 * Web's per-run usage split (`agent-transcript-dialog.tsx:800-828`): the
 * input / output / cache-read / cache-write / cost rows, in that order.
 *
 * Takes the summary rather than the raw slices so the header chip and this
 * panel can share one `summarizeTaskUsage` call per render. The cache rows are
 * conditional on being non-zero, matching web: a zero there means "this run
 * touched no cache", not "zero cache read".
 *
 * A `null` summary (no usage recorded) yields `null` rather than an empty
 * list: the caller then omits the whole block, including its separator, so a
 * run from before usage reporting does not get a dangling divider.
 */
export function buildUsageDetailRows(
  summary: TaskUsageSummary | null,
  formatTokens: (n: number) => string,
  formatCost: (n: number) => string,
): RunDetailRow[] | null {
  if (!summary) return null;

  const rows: RunDetailRow[] = [
    { labelKey: "runs.transcript.detailsInput", value: formatTokens(summary.input) },
    { labelKey: "runs.transcript.detailsOutput", value: formatTokens(summary.output) },
  ];
  if (summary.cacheRead > 0) {
    rows.push({
      labelKey: "runs.transcript.detailsCacheRead",
      value: formatTokens(summary.cacheRead),
    });
  }
  if (summary.cacheWrite > 0) {
    rows.push({
      labelKey: "runs.transcript.detailsCacheWrite",
      value: formatTokens(summary.cacheWrite),
    });
  }
  rows.push({ labelKey: "runs.transcript.detailsCost", value: formatCost(summary.cost) });
  return rows;
}

/**
 * Whether the ⓘ affordance has anything to open — web's `hasRunDetails`
 * (`agent-transcript-dialog.tsx:653-661`). Without this the button would open
 * an empty panel on runs that predate every diagnostic field.
 */
export function hasRunDetails(
  detailRows: readonly RunDetailRow[],
  usageRows: readonly RunDetailRow[] | null,
): boolean {
  return detailRows.length > 0 || (usageRows?.length ?? 0) > 0;
}

/**
 * The single `summarizeTaskUsage` the header and the panel share. `null` for
 * both `undefined` and `[]`: neither means "this run was free", they mean "we
 * have no figure", so the chip hides and the panel omits its usage block
 * rather than claiming 0 (`packages/core/types/agent.ts:390-406`).
 */
export function transcriptUsageSummary(
  usage: readonly TaskUsage[] | undefined,
): TaskUsageSummary | null {
  return summarizeTaskUsage(usage);
}
