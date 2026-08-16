/**
 * Poll cadence for a task's execution log while the task is still running.
 *
 * The Runs sheet caches task messages at `staleTime: Infinity` and relies on
 * WS events as the only refresh path. On mobile networks a socket can go
 * silent without firing `onclose`, so an expanded live run could freeze
 * mid-trace with no way to self-heal. Polling the task-messages endpoint
 * while a live log is expanded closes the gap: the terminal edge (task
 * completes) lands the row in the Past section via the existing task-level
 * WS patch, unmounting the live log and stopping the poll — so there is no
 * steady-state polling once nothing is running.
 */
export const TASK_LOG_POLL_INTERVAL_MS = 3_000;

/** `refetchInterval` for a task log query — polls only while live mode is on. */
export function liveLogPollMs(live: boolean): number | false {
  return live ? TASK_LOG_POLL_INTERVAL_MS : false;
}