/**
 * Autopilot run-list model — the pure half of web's autopilot detail run
 * history (`packages/views/autopilots/components/autopilot-detail-page.tsx`,
 * `RunHistoryList` / `SkippedRunsGroup` / `RunRow`).
 *
 * Two rules are lifted from web verbatim:
 *
 *   - **Skipped runs fold.** A run the backend's pre-flight admission check
 *     refused (`skipped`) is noise once it repeats: web renders the
 *     non-skipped runs inline and puts the skipped tail behind one toggle row
 *     that carries the count and the most recent skip time. A busy schedule
 *     that keeps getting rejected would otherwise bury the runs a user came
 *     to read.
 *   - **Only run-only runs get a transcript.** `run_only` mode dispatches a
 *     task with no issue attached, so the run row is the only place its
 *     execution log can be reached from. An issue-mode run navigates to the
 *     issue instead — web gates on `task_id && !issue_id`.
 *
 * No React / i18n imports: the module runs in the Node vitest lane.
 */
import type { AgentTask, AutopilotRun } from "@multica/core/types";

/** Page size the mobile run history asks for (the endpoint's own default). */
export const AUTOPILOT_RUNS_PAGE_SIZE = 20;

/** The runs endpoint clamps `limit` to 100 — asking for more is a no-op. */
export const AUTOPILOT_RUNS_MAX_LIMIT = 100;

export interface SplitAutopilotRuns {
  /** Runs rendered inline, in the order the server returned them. */
  visible: AutopilotRun[];
  /** `skipped` runs, folded behind the group row. Same order. */
  skipped: AutopilotRun[];
}

/** Web `RunHistoryList`: split the window into inline runs and a skipped tail. */
export function splitAutopilotRuns(
  runs: readonly AutopilotRun[],
): SplitAutopilotRuns {
  const visible: AutopilotRun[] = [];
  const skipped: AutopilotRun[] = [];
  for (const run of runs) {
    if (run.status === "skipped") skipped.push(run);
    else visible.push(run);
  }
  return { visible, skipped };
}

/**
 * Task id to open a transcript for, or null when this run has no transcript
 * affordance. Mirrors web's `syntheticTask && !run.issue_id` gate: a run that
 * produced an issue links to that issue instead.
 */
export function runTranscriptTaskId(run: AutopilotRun): string | null {
  if (!run.task_id || run.issue_id) return null;
  return run.task_id;
}

/**
 * The task status to hand the transcript viewer. Web synthesizes a minimal
 * `AgentTask` from the run and maps `running` / `completed` / `failed`
 * through, defaulting everything else (including `issue_created`, whose task
 * already finished producing an issue) to `queued`.
 */
export function runTaskStatus(run: AutopilotRun): AgentTask["status"] {
  switch (run.status) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "queued";
  }
}

/**
 * Whether to offer "load more". The endpoint reports `total` as the PAGE
 * SIZE, not the table count, so a full page is the only signal that another
 * page might exist; and asking past the server's ceiling returns the same
 * window again, so the button retires there.
 */
export function canLoadMoreRuns(loadedCount: number, limit: number): boolean {
  return loadedCount >= limit && limit < AUTOPILOT_RUNS_MAX_LIMIT;
}
