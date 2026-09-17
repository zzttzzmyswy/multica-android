/**
 * Batch skill-list helpers (MYS-1156). Web (`skill-list-actions.tsx`) loops
 * the single-skill endpoints itself — there is no batch route for skills on
 * the server — and lets the first rejection abort the loop. Mobile runs the
 * same calls concurrently instead of serially (a phone has no reason to pay
 * N round-trips in sequence), which makes *partial* failure a real state that
 * has to be reported: a 5-of-8 delete must not read as "deleted 8".
 *
 * Everything here is pure so the selection rules, the attach plan, and the
 * outcome aggregation are testable without a renderer.
 */
import type { Agent } from "@multica/core/types";

export interface BatchFailure {
  id: string;
  message: string;
}

export interface BatchOutcome {
  succeeded: string[];
  failures: BatchFailure[];
}

/** Flip one id's membership without mutating the caller's set. */
export function toggleId(
  selected: ReadonlySet<string>,
  id: string,
): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Web's header-checkbox rule (`handleToggleAll`): all visible rows selected →
 * clear, otherwise → select every visible row. Scoped to the VISIBLE ids, so
 * a row that a filter scrolled out of the list cannot ride along into the
 * next batch.
 */
export function toggleSelectAllVisible(
  visibleIds: readonly string[],
  selected: ReadonlySet<string>,
): Set<string> {
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  return allSelected ? new Set() : new Set(visibleIds);
}

/**
 * Which of `skillIds` this agent does not have yet. The attach endpoint is
 * additive ("ensure these skills") and idempotent, but sending only the
 * missing subset keeps each request minimal — same filter web applies before
 * calling `addAgentSkills`.
 */
export function missingSkillIds(
  agent: Agent,
  skillIds: readonly string[],
): string[] {
  const owned = new Set((agent.skills ?? []).map((s) => s.id));
  return skillIds.filter((id) => !owned.has(id));
}

/**
 * The per-target requests a batch attach turns into. Targets already holding
 * every selected skill are dropped (nothing to send), and unknown target ids
 * are ignored rather than sent to the server as-is. Caller's target order is
 * preserved so the toast count matches what the sheet showed.
 */
export function planSkillAttach(
  agents: readonly Agent[],
  targetAgentIds: readonly string[],
  skillIds: readonly string[],
): { agentId: string; skillIds: string[] }[] {
  if (skillIds.length === 0) return [];
  const byId = new Map(agents.map((a) => [a.id, a]));
  const plan: { agentId: string; skillIds: string[] }[] = [];
  for (const agentId of targetAgentIds) {
    const agent = byId.get(agentId);
    if (!agent) continue;
    const missing = missingSkillIds(agent, skillIds);
    if (missing.length === 0) continue;
    plan.push({ agentId, skillIds: missing });
  }
  return plan;
}

/**
 * A rejection is only ever shown to the user, so it has to read as a sentence:
 * an `Error`'s message, a thrown string as-is, and nothing at all for the rest
 * (a bare `{}` would otherwise stringify to "[object Object]").
 */
function rejectionMessage(reason: unknown): string {
  if (typeof reason === "string") return reason;
  const message = (reason as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" ? message : "";
}

/**
 * Pair settled results back to the ids that produced them. `allSettled`
 * preserves input order, so index alignment is what ties a rejection to its
 * row; extra results past the id list are ignored.
 */
export function summarizeBatch(
  ids: readonly string[],
  results: readonly PromiseSettledResult<unknown>[],
): BatchOutcome {
  const succeeded: string[] = [];
  const failures: BatchFailure[] = [];
  ids.forEach((id, index) => {
    const result = results[index];
    if (!result) return;
    if (result.status === "fulfilled") {
      succeeded.push(id);
      return;
    }
    failures.push({ id, message: rejectionMessage(result.reason) });
  });
  return { succeeded, failures };
}

/**
 * The one-line result for a batch write: `null` when everything landed (the
 * caller's success toast owns that case), otherwise a failure line naming how
 * many did land and the first error — the message the user can act on.
 */
export function batchOutcomeMessage(
  outcome: BatchOutcome,
  messages: {
    success: (done: number) => string;
    failure: (done: number, failed: number, first: string) => string;
  },
): string | null {
  if (outcome.failures.length === 0) {
    return messages.success(outcome.succeeded.length);
  }
  return messages.failure(
    outcome.succeeded.length,
    outcome.failures.length,
    outcome.failures[0].message,
  );
}
