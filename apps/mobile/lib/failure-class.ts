/**
 * Display grouping for `agent_task_queue.failure_reason`.
 *
 * Mirror of web's `packages/core/dashboard/failure-class.ts` — the backend
 * taxonomy (server/pkg/taskfailure) has 22 reasons, far too many for a
 * stacked chart or a scannable breakdown list. These seven classes are the
 * granularity an operator actually acts on. Ordering below is the render
 * order everywhere (stack segments, legend, breakdown rows):
 * most-actionable first, catchall last.
 */

export const FAILURE_CLASSES = [
  "auth",
  "rate_limit",
  "timeout",
  "provider",
  "runtime",
  "agent",
  "other",
] as const;

export type FailureClass = (typeof FAILURE_CLASSES)[number];

// Reason → class. Keys are the wire values written by the backend: the 22
// canonical `taskfailure.Reason` strings, the `"unclassified"` sentinel the
// failure rollups substitute for a failed row with an empty column, and the
// pre-MUL-1949 coarse values that still sit in historical rows. Anything
// absent falls through to "other" — including a reason from a backend newer
// than this client.
const REASON_CLASS: Record<string, FailureClass> = {
  // Credentials / access.
  "agent_error.provider_auth_or_access": "auth",
  "agent_error.missing_config": "auth",

  // Capacity the account ran out of.
  "agent_error.provider_capacity_or_rate_limit": "rate_limit",
  "agent_error.provider_quota_limit": "rate_limit",

  // Ran too long.
  timeout: "timeout",
  "agent_error.agent_timeout": "timeout",
  codex_semantic_inactivity: "timeout",

  // The upstream model API misbehaved or rejected the request.
  "agent_error.provider_server_error": "provider",
  "agent_error.provider_network": "provider",
  "agent_error.model_not_found_or_unavailable": "provider",
  api_invalid_request: "provider",

  // Multica-side execution substrate.
  runtime_offline: "runtime",
  runtime_recovery: "runtime",
  queued_expired: "runtime",
  "agent_error.runtime_missing_executable": "runtime",
  "agent_error.runtime_version_unsupported": "runtime",
  skill_bundle_unavailable: "runtime",

  // The agent process itself produced the failure.
  "agent_error.process_failure": "agent",
  codex_resume_oversized: "agent",
  "agent_error.empty_or_unparseable_output": "agent",
  "agent_error.context_overflow": "agent",
  iteration_limit: "agent",
  agent_blocked: "agent",

  // Catchall + legacy coarse values.
  "agent_error.unknown": "other",
  agent_error: "other",
  manual: "other",
  unclassified: "other",
};

/**
 * Fold a raw `failure_reason` into its display class. Unknown reasons —
 * including ones a newer backend introduced — resolve to "other". The empty
 * string is the *succeeded* bucket and is never passed here by callers; it
 * also resolves to "other" so a leaked one inflates a visible bucket instead
 * of silently corrupting the error rate.
 */
export function classForReason(reason: string): FailureClass {
  return REASON_CLASS[reason] ?? "other";
}