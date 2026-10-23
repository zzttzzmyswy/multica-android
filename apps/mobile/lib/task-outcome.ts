/**
 * How a run ended, grouped the way `packages/views/agents/components/tabs/
 * task-failure.ts` groups it (iteration 270).
 *
 * This module exists because of a defect one layer down: `AgentTask.failure_
 * reason` used to be parsed through a six-member `z.enum`, so 97% of this
 * deployment's failed runs lost their reason before any screen saw them
 * (see `data/schemas-agent-task-failure-reason.test.ts`). Once the reasons
 * survive the parse, three of them stop being ordinary failures:
 *
 *   - `cancelled` / `user_cancelled` / `manual` are *stops*, not breakages.
 *     A row that says "Failed" and then names a cancellation contradicts
 *     itself, which is exactly the case web's `isCancelledOutcome` prevents.
 *   - the auth / quota / config / model / CLI family cannot be fixed by
 *     retrying, and web flags it (`failureNeedsAction`) so an operator is not
 *     invited to re-run a run that will fail identically.
 *
 * Both predicate sets are copied from web verbatim rather than re-derived:
 * the same row must be classified the same way on both clients.
 */

/** Wire values that record a cancellation, not an error. A run the platform
 *  stopped reads as cancelled even when its row carries status `failed`. */
const CANCELLATION_FAILURE_REASONS: ReadonlySet<string> = new Set([
  "cancelled",
  "manual",
  "user_cancelled",
]);

/** Failures a retry cannot fix until someone changes configuration: the
 *  non-retryable auth, quota, config, model, CLI, and runtime-ownership
 *  reasons documented in `server/pkg/taskfailure`. */
const ACTION_REQUIRED_FAILURE_REASONS: ReadonlySet<string> = new Set([
  "runtime_access_denied",
  "agent_error.provider_auth_or_access",
  "agent_error.provider_quota_limit",
  "agent_error.missing_config",
  "agent_error.model_not_found_or_unavailable",
  "agent_error.runtime_version_unsupported",
  "agent_error.runtime_missing_executable",
]);

export interface TaskOutcome {
  status: string;
  error?: string | null;
  failure_reason?: string | null;
  cancelled_by?: { type: string; name?: string } | null;
}

/** A run that was stopped rather than one that broke. */
export function isCancelledOutcome(task: TaskOutcome): boolean {
  return (
    task.status === "cancelled" ||
    (task.status === "failed" &&
      CANCELLATION_FAILURE_REASONS.has(task.failure_reason ?? ""))
  );
}

/** A failed run whose recovery is a configuration change, not a retry. */
export function failureNeedsAction(task: TaskOutcome): boolean {
  return (
    task.status === "failed" &&
    ACTION_REQUIRED_FAILURE_REASONS.has(task.failure_reason ?? "")
  );
}

/**
 * Localized cancellation status with its recorded actor. Historical rows and
 * malformed partial metadata deliberately return `null` so callers keep the
 * plain "Cancelled" label instead of inventing an unknown person.
 */
export function cancellationActorLabel(
  task: TaskOutcome,
  t: (id: string, vars?: Record<string, string>) => string,
): string | null {
  if (task.status !== "cancelled" || !task.cancelled_by) return null;
  const { type } = task.cancelled_by;
  if (type !== "member" && type !== "agent" && type !== "system") return null;
  if (type === "system") {
    return t("failureReason.cancelled_by_system");
  }
  const name = task.cancelled_by.name?.trim();
  // A member/agent cancellation whose actor name did not resolve must not be
  // printed as "Cancelled by " with a hole where the person belongs.
  return name ? t("failureReason.cancelled_by_actor", { name }) : null;
}

/**
 * Label for a cancelled task the server cancelled for a persisted reason.
 * User-initiated cancellation has no reason and stays unlabeled.
 */
export function cancelReasonLabel(
  task: TaskOutcome,
  t: (id: string, vars?: Record<string, string>) => string,
): string | null {
  if (task.status !== "cancelled") return null;
  const reason = localizedReason(task.failure_reason, t);
  if (reason) return reason;
  return task.error && !task.cancelled_by
    ? t("failureReason.cancelled_by_system")
    : null;
}

/** The bundle's `failureReason.*` copy for a reason, or `null` when the
 *  locale has no entry. Unknown reasons stay `null` here so the caller decides
 *  whether to show the raw wire value (web does) or nothing. */
function localizedReason(
  reason: string | null | undefined,
  t: (id: string, vars?: Record<string, string>) => string,
): string | null {
  if (!reason) return null;
  const key = `failureReason.${reason}`;
  const label = t(key);
  return label === key ? null : label;
}

/**
 * The one label for how a failed or cancelled run ended: its recorded reason,
 * else who cancelled it. `null` when only the plain status is known.
 *
 * Note this is deliberately *not* `runReasonLabel` in `lib/run-row-meta.ts`:
 * that one only speaks for `failed` rows and returns `null` for an unknown
 * reason. This one also covers `cancelled`, and degrades an unknown reason to
 * its raw wire value — same as web — because a name like
 * `agent_error.some_future_classification` still tells an operator more than
 * the word "Failed" does.
 */
export function runOutcomeLabel(
  task: TaskOutcome,
  t: (id: string, vars?: Record<string, string>) => string,
): string | null {
  if (task.status === "failed") {
    if (!task.failure_reason) return null;
    return localizedReason(task.failure_reason, t) ?? task.failure_reason;
  }
  return cancelReasonLabel(task, t) ?? cancellationActorLabel(task, t);
}
