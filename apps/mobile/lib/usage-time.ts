/**
 * Usage-view Time/Tasks aggregation helpers (iteration 45) — mirrors web's
 * dashboard preprocessing in packages/views/dashboard/utils.ts for the
 * run-time / task-count dimension(s): formatDuration, the daily time & task
 * series, and the token↔run-time leaderboard merge.
 *
 * Behavior-parity points with web:
 *  - aggregateDailyTime / aggregateDailyTasks sort dates ascending (chart
 *    x-axis oldest→newest) and subtract cancelled_count from the succeeded
 *    segment so a run the user stopped never renders as "completed"
 *  - mergeAgentDashboardRows prefers the run-time rollup's taskCount (a true
 *    distinct per-agent count) over the token rollup's per-(agent, model)
 *    approximation, and keeps run-time-only agents (zero tokens) on the list;
 *    sorted by tokens desc (mobile's existing leaderboard order), tie-breaking
 *    on run time desc like web
 *  - bucketAgentDashboardRows folds hard-deleted agents into one
 *    DELETED_AGENTS_ROW_ID bucket carrying spend only — the run-time rollups
 *    inner-join `agent`, so deleted agents never contribute seconds or tasks
 *    (web parity; the UI dashes those columns out for the bucket)
 *
 * ES2023 array methods (.toSorted) are avoided: the app's Hermes runtime
 * doesn't implement them, so the code below uses the ES5-era equivalents
 * (.sort / .map over entries).
 */
import type { DashboardAgentRunTime, DashboardRunTimeDaily } from "@multica/core/types";
import {
  DELETED_AGENTS_ROW_ID,
  RESTRICTED_AGENTS_ROW_ID,
  formatDateLabel,
  type AgentUsageRow,
} from "@/lib/usage-format";

export interface AgentDashboardRow {
  agentId: string;
  tokens: number;
  taskCount: number;
  /** Terminal-task run time in seconds (0 for agents with no finished runs). */
  seconds: number;
}

export interface DailyTimeRow {
  /** YYYY-MM-DD server bucket (already in workspace tz). */
  date: string;
  /** Short local label like "8/16", mirrors web formatDateLabel. */
  label: string;
  totalSeconds: number;
}

export interface DailyTasksRow {
  date: string;
  label: string;
  completed: number;
  failed: number;
  cancelled: number;
}

/** Per-date run-time rows → one row per date, ascending (web parity). */
export function aggregateDailyTime(rows: DashboardRunTimeDaily[]): DailyTimeRow[] {
  return rows
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({
      date: r.date,
      label: formatDateLabel(r.date),
      totalSeconds: r.total_seconds,
    }));
}

/**
 * Per-date run-time rows → one row per date with the succeeded count as the
 * remainder. failed_count and cancelled_count are disjoint subsets of
 * task_count; subtracting cancelled matters — without it a run the user
 * stopped would render in the green "completed" segment (web parity).
 */
export function aggregateDailyTasks(rows: DashboardRunTimeDaily[]): DailyTasksRow[] {
  return rows
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => {
      const failed = r.failed_count;
      const cancelled = r.cancelled_count;
      const completed = Math.max(0, r.task_count - failed - cancelled);
      return { date: r.date, label: formatDateLabel(r.date), completed, failed, cancelled };
    });
}

/**
 * Compact human duration: "1h 23m" / "12m 30s" / "45s" / "<1m". Keeps two
 * segments max — three segments adds visual noise without precision the
 * dashboard actually needs (web formatDuration parity).
 */
export function formatDuration(seconds: number, lessThanMinuteLabel: string): string {
  if (seconds < 0 || !Number.isFinite(seconds)) return lessThanMinuteLabel;
  if (seconds < 60) {
    if (seconds < 1) return lessThanMinuteLabel;
    return `${Math.round(seconds)}s`;
  }
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) {
    const secs = Math.floor(seconds) % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const h = hours % 24;
    return h > 0 ? `${days}d ${h}h` : `${days}d`;
  }
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Merge per-agent token totals with per-agent run-time totals into one row
 * per agent.
 *
 * taskCount comes from `runTimeRows` when available — that rollup is a true
 * per-agent distinct count (COUNT(*) on (agent, terminal-task) in SQL). The
 * token rollup's per-(agent, model) counts double-count a task when it spans
 * multiple models, so we only fall back to it for agents with no terminal run
 * yet (in-flight tasks reported tokens but haven't completed). Sorted by
 * tokens desc, then run time desc (web merges on cost desc; mobile has no
 * pricing table, and its existing leaderboard already orders by tokens).
 */
export function mergeAgentDashboardRows(
  tokenRows: AgentUsageRow[],
  runTimeRows: DashboardAgentRunTime[],
): AgentDashboardRow[] {
  const runTimeByAgent = new Map(runTimeRows.map((r) => [r.agent_id, r] as const));
  const merged = new Map<string, AgentDashboardRow>();
  for (const r of tokenRows) {
    const rt = runTimeByAgent.get(r.agentId);
    merged.set(r.agentId, {
      agentId: r.agentId,
      tokens: r.tokens,
      seconds: rt?.total_seconds ?? 0,
      taskCount: rt ? rt.task_count : r.taskCount,
    });
  }
  // Agents with run-time rows but zero tokens still belong on the list (a
  // task that errored before producing usage). Their token column stays 0.
  for (const r of runTimeRows) {
    if (merged.has(r.agent_id)) continue;
    merged.set(r.agent_id, {
      agentId: r.agent_id,
      tokens: 0,
      seconds: r.total_seconds,
      taskCount: r.task_count,
    });
  }
  return Array.from(merged.values()).sort(
    (a, b) => b.tokens - a.tokens || b.seconds - a.seconds || a.agentId.localeCompare(b.agentId),
  );
}

/**
 * Fold merged leaderboard rows whose agent no longer exists into one
 * "Deleted agents" row instead of showing a bare UUID. Matches web's
 * bucketUnknownAgentRows semantics for the merged shape: the bucket carries
 * spend only (seconds / taskCount stay 0 because the run-time rollups
 * inner-join `agent`, so deleted agents already contribute nothing to the
 * Time/Tasks KPIs). The server's restricted bucket passes through as itself —
 * it really did run, and the run-time rollup folds those numbers into it.
 * `knownAgentIds` null (agent list still loading) → pass rows through.
 */
export function bucketAgentDashboardRows(
  rows: AgentDashboardRow[],
  knownAgentIds: ReadonlySet<string> | null,
): AgentDashboardRow[] {
  if (!knownAgentIds) return rows;
  const knownRows: AgentDashboardRow[] = [];
  const bucket: AgentDashboardRow = {
    agentId: DELETED_AGENTS_ROW_ID,
    tokens: 0,
    seconds: 0,
    taskCount: 0,
  };
  let hasDeleted = false;
  for (const r of rows) {
    if (knownAgentIds.has(r.agentId) || r.agentId === RESTRICTED_AGENTS_ROW_ID) {
      knownRows.push(r);
      continue;
    }
    hasDeleted = true;
    bucket.tokens += r.tokens;
  }
  return hasDeleted ? [...knownRows, bucket] : knownRows;
}