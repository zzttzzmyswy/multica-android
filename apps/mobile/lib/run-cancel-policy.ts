/**
 * Cache policy for stopping a run (MYS-2538).
 *
 * Stopping an agent task is not a delete. The server keeps the task and marks
 * it `cancelled` — it stays in the issue's run history with its transcript —
 * and it keeps running for a moment after the request lands. The UI therefore
 * wants three things at once:
 *
 *   - the row keeps existing, so the reader can see WHAT they stopped;
 *   - it says it is stopping, so the tap has visible feedback;
 *   - it becomes `cancelled` only when the server says so, not optimistically.
 *
 * The previous behaviour removed the task from the active-tasks cache inside
 * `onMutate`. The row vanished under the pointer, and if the request failed the
 * `onError` restore made it pop back — a flicker that also lied about the
 * outcome while the request was in flight. On a slow or offline network the row
 * came back only on the WS `task:cancelled` invalidate, so the visible timeline
 * disagreed with the server for as long as the request took.
 *
 * Note on statuses: the wire union (`AgentTask["status"]`) has no in-between
 * cancellation state — a task is `running` or it is `cancelled`. The "stopping"
 * phase is therefore CLIENT-side only, represented by the marker below; the
 * server's answer is what moves the row.
 *
 * These helpers are pure so the policy is testable in the Node lane, where the
 * mutation hook's cache wiring has no renderer to run under.
 */
import type { AgentTask } from "@multica/core/types";

/**
 * Client-only marker: "the user asked to stop this task, and the server has not
 * answered yet". Never sent to the server and never part of `AgentTask`.
 */
export interface CancelMarkerTask extends AgentTask {
  cancel_requested?: boolean;
}

/** Is this run being stopped — i.e. should its row read as "stopping"? */
export function isRunStopping(task: Pick<CancelMarkerTask, "cancel_requested">): boolean {
  return task.cancel_requested === true;
}

/**
 * Does this task still belong in the issue's ACTIVE list after the user pressed
 * stop? Yes — the row must survive the tap. Only the server retires it, by
 * moving it to `cancelled` (at which point the refetched active list no longer
 * contains it at all).
 */
export function staysActiveWhileStopping(): boolean {
  return true;
}

/**
 * Apply the "user pressed stop" marker to the cached active tasks.
 *
 * Deliberately NOT a removal. Returns the SAME array when there is nothing to
 * mark, so an unrelated render does not churn the list.
 */
export function markCancelRequested(
  tasks: AgentTask[] | undefined,
  taskId: string,
): CancelMarkerTask[] | undefined {
  if (!tasks) return tasks;
  let changed = false;
  const next = tasks.map((task) => {
    const marked = task as CancelMarkerTask;
    if (task.id !== taskId || marked.cancel_requested) return marked;
    changed = true;
    return { ...task, cancel_requested: true };
  });
  return changed ? next : (tasks as CancelMarkerTask[]);
}

/** Drop the marker, e.g. after a failed request so the row stops claiming it is
 *  stopping. Same identity contract as `markCancelRequested`. */
export function clearCancelRequested(
  tasks: CancelMarkerTask[] | undefined,
  taskId: string,
): CancelMarkerTask[] | undefined {
  if (!tasks) return tasks;
  let changed = false;
  const next = tasks.map((task) => {
    if (task.id !== taskId || !task.cancel_requested) return task;
    changed = true;
    const { cancel_requested: _drop, ...rest } = task;
    return rest;
  });
  return changed ? next : tasks;
}
