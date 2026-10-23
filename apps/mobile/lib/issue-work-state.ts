/**
 * What the issue detail page is allowed to claim about agent work right now.
 *
 * One question, three surfaces — the in-card activity row
 * (`agent-activity-row.tsx`), the Stack header badge (`agent-header-badge.tsx`)
 * and the row-level indicator (`issue-agent-activity-indicator.tsx`). They
 * must agree, so the decision lives here once instead of in three components
 * that each re-derive it slightly differently. (They did: two of them read a
 * non-empty active-task list as "working".)
 *
 * The server's active-task endpoint returns four statuses —
 *
 *     queued | dispatched | running | waiting_local_directory
 *     (server/pkg/db/queries/agent.sql:1647)
 *
 * — and only one of them means an agent is producing output. Web separates
 * them in `packages/views/issues/components/issue-agent-header-chip.tsx`
 * (`is_working` vs `is_queued`), and after this module so does the phone.
 *
 * `deferred` is not in the server's set, but callers outside this page (the
 * workspace snapshot) do carry it, so the predicate accepts it and applies the
 * same condition as core's `isQueuedTaskStatus`: a retry parked until
 * `fire_at` is only "in line" when a wakeup rule will fire it. An orphaned
 * deferred row is not on its way to running and must not be counted as live.
 */
import type { AgentTask } from "@multica/core/types";

/** The slice of a task this module reads. Kept structural so callers can pass
 *  a full `AgentTask` without a cast, and so the tests can build a task
 *  without inventing every unrelated field. */
type WorkTask = Pick<AgentTask, "status"> & {
  agent_id?: string;
  wakeup_id?: string;
};

export interface IssueWorkPartition<T extends WorkTask = AgentTask> {
  running: T[];
  queued: T[];
}

/**
 * Split a task list into "actually running" and "waiting to start".
 *
 * Terminal statuses fall out of both buckets — they are the execution log's
 * story, not a live claim about the present.
 */
export function partitionIssueWork<T extends WorkTask>(
  tasks: readonly T[],
): IssueWorkPartition<T> {
  const running: T[] = [];
  const queued: T[] = [];
  for (const task of tasks) {
    if (task.status === "running") {
      running.push(task);
    } else if (
      task.status === "queued" ||
      task.status === "dispatched" ||
      task.status === "waiting_local_directory" ||
      (task.status === "deferred" && !!task.wakeup_id)
    ) {
      queued.push(task);
    }
  }
  return { running, queued };
}

export type IssueWorkState = "running" | "queued" | "idle";

export interface IssueWorkSummary {
  state: IssueWorkState;
  /** Distinct agent ids for the winning bucket, in first-seen order. Empty
   *  when idle. */
  agentIds: string[];
}

export const IDLE_ISSUE_WORK: IssueWorkSummary = { state: "idle", agentIds: [] };

/**
 * Collapse a partition into the single claim a surface renders.
 *
 * Running wins: an issue with one task running and three waiting reads as
 * "working", because that is the fact someone scanning the list is looking
 * for. The faces shown are the running agents — the agentIds come from the
 * same bucket the label describes, so the avatars and the words cannot
 * disagree.
 */
export function summarizeIssueWork(
  tasks: readonly WorkTask[],
): IssueWorkSummary {
  const { running, queued } = partitionIssueWork(tasks);
  const winning = running.length > 0 ? running : queued;
  if (winning.length === 0) return IDLE_ISSUE_WORK;
  return {
    state: running.length > 0 ? "running" : "queued",
    agentIds: [
      ...new Set(
        winning
          .map((task) => task.agent_id ?? "")
          .filter((id): id is string => id.length > 0),
      ),
    ],
  };
}
