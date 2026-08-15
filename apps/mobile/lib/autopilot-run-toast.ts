/**
 * Classifies a manual "run now" outcome into success / warning / error.
 * Pure port of web `packages/views/autopilots/components/run-now-toast.ts`
 * (MUL-4525): the trigger endpoint returns 200 even when admission blocks
 * the run, so the UI must branch on the run's domain status — success is a
 * WHITELIST, never "anything that isn't skipped/failed". A future or
 * anomalous-but-parseable status degrades to an error, never a false
 * "triggered".
 */
export type RunNowToastKind = "success" | "warning" | "error";

export function runNowToastKind(status: string | undefined): RunNowToastKind {
  switch (status) {
    case "issue_created":
    case "running":
      return "success";
    case "skipped":
      // Admission blocked / target not ready — recoverable, informational.
      return "warning";
    case "failed":
      return "error";
    default:
      // Unknown / future status: never claim success.
      return "error";
  }
}

/**
 * The i18n key suffix (under the `autopilots.` namespace) describing why a
 * non-success run did not trigger, keyed on the stable server reason_code.
 * Unknown/absent code degrades to a generic message. Mirrors web's
 * `runNowBlockedKey` one-to-one.
 */
export type RunNowBlockedKey =
  | "runBlockedInvocationNotAllowed"
  | "runBlockedRuntimeOffline"
  | "runBlockedAgentRuntimeRequired"
  | "runBlockedTargetUnavailable"
  | "runBlockedAttribution"
  | "runBlockedAlreadyActive"
  | "runBlockedGeneric";

export function runNowBlockedKey(
  reasonCode: string | undefined,
): RunNowBlockedKey {
  switch (reasonCode) {
    case "invocation_not_allowed":
      return "runBlockedInvocationNotAllowed";
    case "runtime_offline":
      return "runBlockedRuntimeOffline";
    // Unbound, not offline: nothing will claim the run until the agent is
    // bound to a runtime (MUL-5559).
    case "agent_runtime_required":
      return "runBlockedAgentRuntimeRequired";
    case "target_unavailable":
      return "runBlockedTargetUnavailable";
    case "attribution_blocked":
      return "runBlockedAttribution";
    case "already_active":
      return "runBlockedAlreadyActive";
    default:
      return "runBlockedGeneric";
  }
}