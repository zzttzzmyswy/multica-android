/**
 * Commit rule for the agent "Concurrency" property (iteration 181,
 * MYS-1564 / G29) — a direct port of web's `ConcurrencyField` commit guard
 * (`packages/views/agents/components/agent-detail-inspector.tsx:330-340`).
 *
 * Lives in `lib/` rather than beside the component because it is pure input
 * validation with a rollback branch, and the repo's vitest include is
 * `lib/**` + `data/**` (`vitest.config.ts:25`) — a rule this close to the
 * write path deserves the unit coverage.
 *
 * Bounds come from `@multica/core/agents` (the same constants the backend
 * validates against), never literals, so the field, its hint copy and the
 * server cannot drift.
 */
import {
  AGENT_MAX_CONCURRENT_TASKS_MAX,
  AGENT_MAX_CONCURRENT_TASKS_MIN,
} from "@multica/core/agents";

/**
 * The value to PATCH, or `null` when nothing should be sent.
 *
 * `null` covers both "roll back the draft" (non-integer / out of range) and
 * "no change" — the caller treats them identically (reseat the draft from the
 * server value), which is exactly web's `commit`.
 */
export function resolveConcurrencyCommit(
  draft: string,
  current: number,
): number | null {
  const next = Number(draft);
  if (
    !Number.isInteger(next) ||
    next < AGENT_MAX_CONCURRENT_TASKS_MIN ||
    next > AGENT_MAX_CONCURRENT_TASKS_MAX
  ) {
    return null;
  }
  return next === current ? null : next;
}
