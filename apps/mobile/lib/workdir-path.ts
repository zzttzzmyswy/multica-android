/**
 * "Copy local workdir path" support — port of web's `pickLatestWorkDir`
 * (packages/views/issues/actions/issue-actions-menu-items.tsx:329).
 *
 * The clipboard is the one sanctioned way to surface `work_dir`: it is a
 * deliberate user action on their own machine, not a display surface, so it
 * does not run into the "never render `work_dir` raw" rule that governs
 * `relative_work_dir` (packages/core/types/agent.ts:360-377).
 *
 * Selection rule matches web exactly: scan the task list, skip entries with no
 * (or empty) `work_dir`, and keep the greatest `created_at`. Comparing the raw
 * ISO strings is safe — the server emits a fixed-width UTC format — and a tie
 * or an empty timestamp resolves to the first entry encountered, which keeps
 * the pick deterministic rather than dependent on the server's row order.
 */
import type { AgentTask } from "@multica/core/types";

export function pickLatestWorkDir(tasks: AgentTask[] | undefined): string | undefined {
  if (!tasks?.length) return undefined;
  let latest: AgentTask | undefined;
  for (const task of tasks) {
    if (!task.work_dir) continue;
    if (!latest || task.created_at > latest.created_at) {
      latest = task;
    }
  }
  return latest?.work_dir;
}
