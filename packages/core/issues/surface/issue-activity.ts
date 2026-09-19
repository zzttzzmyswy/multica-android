/**
 * Pure projections of the workspace-wide agent task snapshot onto issue
 * surfaces — "which issues has an agent got in flight right now", and the
 * per-issue slice a row badge renders from.
 *
 * Lives in core because three consumers on two ends draw the same line:
 *   - web's `IssueAgentActivityIndicator` (list rows, board cards, inbox rows)
 *     and `useIssueSurfaceActivity` (the "agents working" list filter),
 *   - mobile's `IssueAgentActivityIndicator` (same three surfaces) and
 *     `useRunningIssueIds` (same filter).
 *
 * Before this module the predicate existed twice — web's `deriveIssueSurfaceActivity`
 * and mobile's `deriveRunningIssueIds` — with a comment on the mobile copy
 * acknowledging it mirrored the web one. Anything that changes what counts as
 * "active" (a new non-terminal task status, say) has to move both ends at
 * once, so the definition belongs in one place.
 *
 * No runtime imports: mobile imports this directly and its modules must stay
 * free of the React Query / ApiClient singletons that core's `agents/queries`
 * pulls in.
 */
import type { AgentTask } from "../../types";

/**
 * Task statuses that mean "the agent has this queued but has not started".
 * `waiting_local_directory` is the daemon-emitted hold state for the
 * local_directory flow: dispatched, but parked behind another task holding
 * the same on-disk path lock. It is a non-terminal wait, so it reads as
 * queued rather than running.
 */
export function isQueuedTaskStatus(status: AgentTask["status"]): boolean {
  return (
    status === "queued" ||
    status === "dispatched" ||
    status === "waiting_local_directory"
  );
}

export interface IssueTaskGroups {
  running: AgentTask[];
  queued: AgentTask[];
}

/**
 * Per-issue slice of the workspace-wide snapshot. Used as the `select` for a
 * row-level `useQuery(agentTaskSnapshotOptions)`: every row still observes
 * the one shared snapshot query, but React Query's structural sharing keeps
 * this returned object referentially stable when *this* issue's tasks are
 * unchanged, so a snapshot invalidation only re-renders the rows whose own
 * tasks actually moved — not the whole list. Terminal statuses are dropped
 * (they belong on issue history, not the live indicator).
 */
export function selectIssueTasks(
  snapshot: readonly AgentTask[],
  issueId: string,
): IssueTaskGroups {
  const running: AgentTask[] = [];
  const queued: AgentTask[] = [];
  for (const task of snapshot) {
    if (task.issue_id !== issueId) continue;
    if (task.status === "running") running.push(task);
    else if (isQueuedTaskStatus(task.status)) queued.push(task);
  }
  return { running, queued };
}

export type IssueAgentActivityState = "running" | "queued" | "idle";

export interface IssueAgentActivity {
  state: IssueAgentActivityState;
  /** Distinct agent ids to stack, in first-seen order. Empty when idle. */
  agentIds: string[];
}

export const IDLE_ISSUE_AGENT_ACTIVITY: IssueAgentActivity = {
  state: "idle",
  agentIds: [],
};

/**
 * Collapse a task slice into what a badge renders.
 *
 * Running wins over queued: an issue with one task running and three waiting
 * reads as "Working", because that is the fact the reader is scanning for.
 * The two states are visually distinct (animated cue + foreground text vs.
 * a half-opacity stack + muted text) so the badge always carries a face.
 */
export function summarizeIssueActivity(
  groups: IssueTaskGroups,
): IssueAgentActivity {
  const primary = groups.running.length > 0 ? groups.running : groups.queued;
  if (primary.length === 0) return IDLE_ISSUE_AGENT_ACTIVITY;
  return {
    state: groups.running.length > 0 ? "running" : "queued",
    agentIds: [...new Set(primary.map((task) => task.agent_id))],
  };
}

/**
 * Distinct issue ids with at least one RUNNING agent task.
 *
 * Queued / dispatched / waiting_local_directory tasks are deliberately
 * EXCLUDED: the "agents working now" list filter means "an agent is on it
 * right now"; a queued task has not started, and counting it would show a
 * list of issues nobody is working on under a filter that promises the
 * opposite.
 *
 * Tasks with an empty `issue_id` (chat- or autopilot-spawned) are skipped —
 * they belong to no issue row to keep.
 */
export function deriveRunningIssueIds(
  tasks: readonly AgentTask[],
): Set<string> {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (task.status !== "running") continue;
    if (!task.issue_id) continue;
    ids.add(task.issue_id);
  }
  return ids;
}

export interface IssueActivityState {
  isWorking: boolean;
  isQueued: boolean;
  runningTasks: AgentTask[];
  queuedTasks: AgentTask[];
}

export interface IssueSurfaceActivity {
  activityByIssueId: Map<string, IssueActivityState>;
  runningIssueIds: Set<string>;
}

/**
 * Whole-snapshot projection behind the "agents working now" filter: every
 * issue with at least one non-terminal task, bucketed, plus the running-only
 * id set derived from it.
 */
export function deriveIssueSurfaceActivity(
  tasks: readonly AgentTask[],
): IssueSurfaceActivity {
  const activityByIssueId = new Map<string, IssueActivityState>();

  for (const task of tasks) {
    if (!task.issue_id) continue;
    if (task.status !== "running" && !isQueuedTaskStatus(task.status)) {
      continue;
    }

    const current = activityByIssueId.get(task.issue_id) ?? {
      isWorking: false,
      isQueued: false,
      runningTasks: [],
      queuedTasks: [],
    };

    if (task.status === "running") {
      current.runningTasks.push(task);
      current.isWorking = true;
    } else {
      current.queuedTasks.push(task);
      current.isQueued = true;
    }

    activityByIssueId.set(task.issue_id, current);
  }

  return { activityByIssueId, runningIssueIds: deriveRunningIssueIds(tasks) };
}
