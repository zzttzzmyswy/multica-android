/**
 * Per-agent 30-day activity derivation — ported 1:1 from web
 * `packages/core/agents/use-agent-activity.ts` (deriveAgentActivity /
 * buildActivityMap / summarizeActivityWindow) and the pure helpers in
 * `packages/views/agents/components/tabs/activity-tab.tsx`
 * (deriveAvgDurationLast30d / formatDurationMs). No @multica/core
 * dependency: buckets come from the workspace 30d endpoint and tasks from the
 * per-agent task list.
 *
 * Window semantics preserved: fixed 30 zero-filled daily slots where index 0
 * is the OLDEST day and index 29 is "today" in local time (the back-end
 * truncates bucket_at to UTC midnight, but the user's mental model is
 * today/yesterday in their own timezone — so the front-end re-floors both
 * now and the buckets to the local day boundary before bucketing).
 */
import type { Agent, AgentActivityBucket, AgentTask } from "@multica/core/types";

export const ACTIVITY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * DAY_MS;

/** One day's tally for the sparkline. */
export interface ActivityBucket {
  total: number;
  failed: number;
}

export interface AgentActivity {
  /** 30 daily buckets, oldest → newest. Days with no activity are
   *  zero-filled. Each surface picks how much of the tail to render: the
   *  agents list uses 7, the agent detail uses all 30. */
  buckets: ActivityBucket[];
  /** Days the agent has existed, capped at ACTIVITY_DAYS. Pure cosmetic —
   *  used by tooltip copy ("Created 3 days ago"). */
  daysSinceCreated: number;
}

export interface ActivityWindowSummary {
  /** Trailing-N buckets from the activity series (newest end). */
  buckets: ActivityBucket[];
  /** Sum of `bucket.total` across the window. */
  totalRuns: number;
  /** Sum of `bucket.failed` across the window. */
  totalFailed: number;
  /** Echo of the input window — the renderer uses it for copy. */
  windowDays: number;
}

const EMPTY: AgentActivity = {
  buckets: Array.from({ length: ACTIVITY_DAYS }, () => ({ total: 0, failed: 0 })),
  daysSinceCreated: ACTIVITY_DAYS,
};

const EMPTY_SUMMARY: ActivityWindowSummary = {
  buckets: [],
  totalRuns: 0,
  totalFailed: 0,
  windowDays: 0,
};

/** Local-time day boundary. `Date.setHours` mutates, so clone first. */
function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Derive one agent's 30-slot daily activity series from its buckets. */
export function deriveAgentActivity(
  buckets: readonly AgentActivityBucket[],
  agentCreatedAt: string,
  now: number,
): AgentActivity {
  const series: ActivityBucket[] = Array.from({ length: ACTIVITY_DAYS }, () => ({
    total: 0,
    failed: 0,
  }));

  // Newest slot is the start of "today" in local time; walk back DAYS slots
  // so index 0 = oldest, index DAYS-1 = today.
  const today = startOfDay(now);

  for (const b of buckets) {
    const ts = new Date(b.bucket_at).getTime();
    if (Number.isNaN(ts)) continue;
    const daysAgo = Math.floor((today - startOfDay(ts)) / DAY_MS);
    if (daysAgo < 0 || daysAgo >= ACTIVITY_DAYS) continue;
    const slot = ACTIVITY_DAYS - 1 - daysAgo;
    series[slot]!.total += b.task_count;
    series[slot]!.failed += b.failed_count;
  }

  const createdAt = new Date(agentCreatedAt).getTime();
  const ageMs = Number.isFinite(createdAt) ? now - createdAt : Infinity;
  const daysSinceCreated = Math.min(
    ACTIVITY_DAYS,
    Math.max(0, Math.floor(ageMs / DAY_MS)),
  );

  return { buckets: series, daysSinceCreated };
}

/** Build the per-agent activity map for the workspace (one bucket pass). */
export function buildActivityMap(
  agents: readonly Agent[],
  buckets: readonly AgentActivityBucket[],
  now: number,
): Map<string, AgentActivity> {
  // Group buckets by agent once so per-agent derivation is O(buckets) not
  // O(agents × buckets).
  const bucketsByAgent = new Map<string, AgentActivityBucket[]>();
  for (const b of buckets) {
    const list = bucketsByAgent.get(b.agent_id);
    if (list) list.push(b);
    else bucketsByAgent.set(b.agent_id, [b]);
  }

  const out = new Map<string, AgentActivity>();
  for (const agent of agents) {
    out.set(
      agent.id,
      deriveAgentActivity(bucketsByAgent.get(agent.id) ?? [], agent.created_at, now),
    );
  }
  return out;
}

/** Summarise a trailing window of the activity series. */
export function summarizeActivityWindow(
  activity: AgentActivity | undefined,
  windowDays: number,
): ActivityWindowSummary {
  if (!activity) return { ...EMPTY_SUMMARY, windowDays };
  const safeWindow = Math.min(
    Math.max(0, windowDays),
    activity.buckets.length,
  );
  // `slice(-0)` returns the full array (JS quirk: -0 === 0), so guard
  // explicitly when no window is requested.
  const slice =
    safeWindow === 0 ? [] : activity.buckets.slice(-safeWindow);
  let totalRuns = 0;
  let totalFailed = 0;
  for (const b of slice) {
    totalRuns += b.total;
    totalFailed += b.failed;
  }
  return { buckets: slice, totalRuns, totalFailed, windowDays };
}

/** Average completed→started duration of tasks finished within the last 30
 *  days (a rolling clock window on completed_at, not day-aligned). Includes
 *  failed tasks — any terminal run with a real duration. 0 when nobody
 *  qualifies. */
export function deriveAvgDurationLast30d(
  tasks: readonly AgentTask[],
  now: number,
): number {
  let sum = 0;
  let count = 0;
  for (const t of tasks) {
    if (!t.completed_at || !t.started_at) continue;
    const completedAt = new Date(t.completed_at).getTime();
    if (Number.isNaN(completedAt)) continue;
    if (now - completedAt > THIRTY_DAYS_MS) continue;
    const startedAt = new Date(t.started_at).getTime();
    const dur = completedAt - startedAt;
    if (Number.isFinite(dur) && dur > 0) {
      sum += dur;
      count += 1;
    }
  }
  return count > 0 ? Math.round(sum / count) : 0;
}

/** Compact clock duration ("3m 05s", "1h 12m") matching web's helper. */
export function formatDurationMs(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 60_000) {
    return `${Math.max(1, Math.round(ms / 1000))}s`;
  }
  if (ms < 60 * 60_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return `${m}m ${String(s).padStart(2, "0")}s`;
  }
  const h = Math.floor(ms / (60 * 60_000));
  const m = Math.floor((ms % (60 * 60_000)) / 60_000);
  return `${h}h ${m}m`;
}

// =====================================================
// Activity-tab task selection helpers — ported from the selection logic in
// web `packages/views/agents/components/tabs/activity-tab.tsx`.
// =====================================================

/** Statuses that count as in-flight in the "Now" section. */
export const ACTIVE_TASK_STATUSES: ReadonlySet<string> = new Set([
  "queued",
  "dispatched",
  "waiting_local_directory",
  "running",
]);

/** Statuses that show an inline cancel affordance (nowaiting_local_directory:
 *  the user's own cancel would race the daemon's park/unpark cycle). */
export const CANCELLABLE_TASK_STATUSES: ReadonlySet<string> = new Set([
  "queued",
  "dispatched",
  "running",
]);

const TERMINAL_TASK_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

// Now-section ordering: running → dispatched → waiting_local_directory →
// queued (the board "urgency" order web uses).
const NOW_STATUS_RANK: Record<string, number> = {
  running: 0,
  dispatched: 1,
  waiting_local_directory: 2,
  queued: 3,
};

/** Recent-work pagination constants (web RECENT_INITIAL / RECENT_PAGE). */
export const RECENT_INITIAL = 10;
export const RECENT_PAGE = 20;

/** Chat tasks carry a chat_session_id and live in their own chat UI; every
 *  agent-scoped surface hides them (web activity-tab isWorkflowTask). */
export function isWorkflowTask(task: AgentTask): boolean {
  return !task.chat_session_id;
}

/** Filter the workspace task snapshot to one agent's in-flight work and
 *  order it the activity-tab way: status rank, then created_at asc. */
export function sortActiveAgentTasks(
  snapshot: readonly AgentTask[],
  agentId: string,
): AgentTask[] {
  return snapshot
    .filter(
      (t) =>
        t.agent_id === agentId &&
        isWorkflowTask(t) &&
        ACTIVE_TASK_STATUSES.has(t.status),
    )
    .sort(
      (a, b) =>
        (NOW_STATUS_RANK[a.status] ?? 99) - (NOW_STATUS_RANK[b.status] ?? 99) ||
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
}

/** Filter one agent's full history to terminal workflow runs and order by
 *  completed_at desc (most recent first). Cancelled included — users
 *  searching "what just happened" want cancellations beside completions. */
export function sortRecentAgentTasks(
  tasks: readonly AgentTask[],
  agentId: string,
): AgentTask[] {
  return tasks
    .filter(
      (t) =>
        t.agent_id === agentId &&
        isWorkflowTask(t) &&
        !!t.completed_at &&
        TERMINAL_TASK_STATUSES.has(t.status),
    )
    .sort(
      (a, b) =>
        new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime(),
    );
}