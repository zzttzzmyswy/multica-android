/**
 * Run-outcome classification and labels (iteration 270).
 *
 * The behaviours pinned here are copied from web's `task-failure.ts` so the
 * same run reads the same way on both clients. They exist on mobile now
 * because the layer below them was repaired in the same iteration: until
 * `AgentTask.failure_reason` stopped being a six-member enum, 97% of failed
 * runs arrived with no reason, so none of these distinctions had anything to
 * distinguish.
 */
import { describe, expect, it } from "vitest";
import en from "./i18n/locales/en.json";
import zh from "./i18n/locales/zh.json";
import {
  cancelReasonLabel,
  cancellationActorLabel,
  failureNeedsAction,
  isCancelledOutcome,
  runOutcomeLabel,
} from "./task-outcome";

// Minimal stand-in for the app's `t`: looks the key up in the real en bundle
// and echoes the id back when absent, which is exactly what the real
// `translate()` does and what every fallback branch here keys off.
const t = (id: string, vars?: Record<string, string>): string => {
  const raw = (en as Record<string, string>)[id];
  if (raw === undefined) return id;
  return vars
    ? raw.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "")
    : raw;
};

describe("isCancelledOutcome", () => {
  it("treats the cancellation wire values on a failed row as a stop, not a breakage", () => {
    // `cancelled` arrived 13 times in the live sample, every one of them with
    // status `failed`. Rendering "Failed · Cancelled by the system" is the
    // contradiction this predicate exists to prevent.
    expect(isCancelledOutcome({ status: "failed", failure_reason: "cancelled" })).toBe(true);
    expect(isCancelledOutcome({ status: "failed", failure_reason: "user_cancelled" })).toBe(true);
    expect(isCancelledOutcome({ status: "failed", failure_reason: "manual" })).toBe(true);
  });

  it("treats a cancelled status as a stop regardless of reason", () => {
    expect(isCancelledOutcome({ status: "cancelled" })).toBe(true);
  });

  it("leaves a genuine failure alone", () => {
    expect(isCancelledOutcome({ status: "failed", failure_reason: "timeout" })).toBe(false);
    expect(isCancelledOutcome({ status: "failed" })).toBe(false);
    expect(isCancelledOutcome({ status: "completed" })).toBe(false);
  });

  it("does not read a stale reason on a completed row as a cancellation", () => {
    // The `failed` half of the predicate is load-bearing. A row that finished
    // successfully can still carry a leftover reason field (a retried run
    // reuses the row); without the status gate it would be painted as a
    // cancellation and lose its own status label.
    expect(
      isCancelledOutcome({ status: "completed", failure_reason: "cancelled" }),
    ).toBe(false);
    expect(
      isCancelledOutcome({ status: "running", failure_reason: "user_cancelled" }),
    ).toBe(false);
  });
});

describe("failureNeedsAction", () => {
  it("flags failures a retry cannot fix", () => {
    expect(failureNeedsAction({ status: "failed", failure_reason: "agent_error.provider_auth_or_access" })).toBe(true);
    expect(failureNeedsAction({ status: "failed", failure_reason: "runtime_access_denied" })).toBe(true);
    expect(failureNeedsAction({ status: "failed", failure_reason: "agent_error.provider_quota_limit" })).toBe(true);
    expect(failureNeedsAction({ status: "failed", failure_reason: "agent_error.missing_config" })).toBe(true);
  });

  it("does not flag transient failures", () => {
    expect(failureNeedsAction({ status: "failed", failure_reason: "agent_error.provider_capacity_or_rate_limit" })).toBe(false);
    expect(failureNeedsAction({ status: "failed", failure_reason: "timeout" })).toBe(false);
  });

  it("only speaks for failed rows", () => {
    expect(failureNeedsAction({ status: "cancelled", failure_reason: "runtime_access_denied" })).toBe(false);
    expect(failureNeedsAction({ status: "completed", failure_reason: "runtime_access_denied" })).toBe(false);
  });
});

describe("runOutcomeLabel", () => {
  it("labels a failed row from its reason", () => {
    expect(runOutcomeLabel({ status: "failed", failure_reason: "cancelled" }, t)).toBe(
      "Cancelled by the system",
    );
    expect(runOutcomeLabel({ status: "failed", failure_reason: "agent_error.provider_quota_limit" }, t)).toBe(
      "Provider quota exhausted",
    );
  });

  it("returns null when a failed row has no reason", () => {
    expect(runOutcomeLabel({ status: "failed", failure_reason: null }, t)).toBeNull();
    expect(runOutcomeLabel({ status: "failed" }, t)).toBeNull();
  });

  it("degrades an unknown reason to its raw wire value instead of hiding it", () => {
    // Web's rule, and strictly more useful than a bare "Failed": the operator
    // at least learns which classifier fired.
    expect(
      runOutcomeLabel({ status: "failed", failure_reason: "agent_error.some_future_classification" }, t),
    ).toBe("agent_error.some_future_classification");
  });

  it("prefers a cancelled row's recorded reason over its actor", () => {
    expect(
      runOutcomeLabel(
        { status: "cancelled", failure_reason: "queued_expired", cancelled_by: { type: "system" } },
        t,
      ),
    ).toBe("Expired in queue");
  });

  it("names who cancelled a cancelled row that has no reason", () => {
    expect(
      runOutcomeLabel({ status: "cancelled", cancelled_by: { type: "member", name: "MYSWY" } }, t),
    ).toBe("Cancelled by MYSWY");
    expect(
      runOutcomeLabel({ status: "cancelled", cancelled_by: { type: "system" } }, t),
    ).toBe("Cancelled by the system");
  });

  it("stays silent for a cancelled row with nothing recorded", () => {
    expect(runOutcomeLabel({ status: "cancelled" }, t)).toBeNull();
  });
});

describe("cancellationActorLabel", () => {
  it("never invents a person when the actor name did not resolve", () => {
    // A half-populated `cancelled_by` would otherwise print "Cancelled by ".
    expect(cancellationActorLabel({ status: "cancelled", cancelled_by: { type: "member" } }, t)).toBeNull();
    expect(cancellationActorLabel({ status: "cancelled", cancelled_by: { type: "member", name: "   " } }, t)).toBeNull();
  });

  it("ignores an unrecognised actor type", () => {
    // The wire value is open; a future actor type must not be rendered as if
    // it were a known one.
    expect(cancellationActorLabel({ status: "cancelled", cancelled_by: { type: "scheduler", name: "x" } }, t)).toBeNull();
  });

  it("does not speak for rows that were not cancelled", () => {
    expect(cancellationActorLabel({ status: "failed", cancelled_by: { type: "system" } }, t)).toBeNull();
  });
});

describe("cancelReasonLabel", () => {
  it("explains a system cancellation that carries an error but no actor", () => {
    expect(cancelReasonLabel({ status: "cancelled", error: "worktree claim refused" }, t)).toBe(
      "Cancelled by the system",
    );
  });

  it("stays silent for a user-initiated cancellation", () => {
    expect(cancelReasonLabel({ status: "cancelled" }, t)).toBeNull();
  });
});

describe("the bundles actually carry the copy these labels look up", () => {
  // The whole defect was a lookup with nothing to find. These assertions keep
  // the label table and the bundle from drifting apart again in either
  // direction: every reason the server writes must have copy, and the copy
  // must resolve rather than echo its own key back.
  const LIVE_AND_CANONICAL = [
    "agent_error.unknown",
    "agent_error.provider_quota_limit",
    "agent_error.process_failure",
    "agent_error.provider_server_error",
    "agent_error.provider_network",
    "agent_error.provider_auth_or_access",
    "agent_error.context_overflow",
    "agent_error.provider_capacity_or_rate_limit",
    "agent_error.agent_timeout",
    "agent_error.empty_or_unparseable_output",
    "agent_error.missing_config",
    "agent_error.model_not_found_or_unavailable",
    "agent_error.runtime_version_unsupported",
    "agent_error.runtime_missing_executable",
    "api_invalid_request",
    "queued_expired",
    "iteration_limit",
    "agent_blocked",
    "skill_bundle_unavailable",
    "runtime_offline",
    "runtime_recovery",
    "timeout",
    "cancelled",
    "idle_watchdog",
    "codex_resume_oversized",
    "codex_semantic_inactivity",
    "local_directory_error",
    "user_cancelled",
    "agent_fallback_message",
    "runtime_access_denied",
    "runtime_access_revoked",
    "runtime_reconnect_timeout",
    "runtime_cli_timeout",
    "environment_prepare_failed",
    "invalid_task_identity",
    "agent_error",
    "manual",
  ];

  it.each(LIVE_AND_CANONICAL)("resolves copy for %s in every shipped bundle", (reason) => {
    // Both locales, not just en. A zh-only gap is invisible from the English
    // UI and still shows a raw wire value to half the users — the same class
    // of defect as the schema drop, one layer up.
    const key = `failureReason.${reason}`;
    for (const [locale, bundle] of Object.entries({ en, zh })) {
      const copy = (bundle as Record<string, string>)[key];
      expect(copy, `${locale} missing ${key}`).toBeTruthy();
      expect(copy?.trim(), `${locale} has empty ${key}`).not.toBe("");
    }
    expect(t(key)).not.toBe(key);
  });

  it("resolves copy for the cancellation sentence forms", () => {
    expect(t("failureReason.cancelled_by_system")).not.toBe("failureReason.cancelled_by_system");
    expect(t("failureReason.cancelled_by_actor", { name: "Ada" })).toBe("Cancelled by Ada");
  });
});
