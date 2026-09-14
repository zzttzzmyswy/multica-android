/**
 * The "which issues is an agent working on right now" projection, kept free
 * of fetching so the issue-list surfaces can filter on it and the predicate
 * stays a pure function (web draws the same line at
 * `packages/views/issues/surface/filter.ts` vs. `activity.ts`).
 *
 * Mirrors the `runningIssueIds` half of web's `deriveIssueSurfaceActivity`
 * (packages/views/issues/surface/activity.ts:57-92), restricted to running:
 * queued / dispatched / waiting_local_directory tasks are deliberately
 * EXCLUDED. Web's `agentRunningFilter` means "an agent is working on it right
 * now"; a queued task has not started, and counting it would show a list of
 * issues nobody is working on under a filter that promises the opposite.
 */
import type { AgentTask } from "@multica/core/types";

/**
 * Distinct issue ids with at least one RUNNING agent task.
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
