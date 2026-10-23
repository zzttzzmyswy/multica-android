/**
 * `AgentTask.failure_reason` vocabulary (iteration 270).
 *
 * This is a FACT bug, not a wording one. The server's canonical taxonomy
 * (`server/pkg/taskfailure/failure.go`) names 22 refined values plus the
 * pre-MUL-1949 coarse ones still present on historical rows; the wire field is
 * deliberately an open string (`packages/core/types/agent.ts`: "Open string on
 * the wire, not a closed enum"). This schema nevertheless pinned it to a
 * six-member `z.enum` ending in `.catch("")`, so every value outside that set
 * was silently rewritten to `""` and then normalized to `undefined`.
 *
 * Measured on the live deployment (1,200 issues / 3,023 task-runs): 134 rows
 * were failed with a reason, and **130 (97.0%)** parsed to `undefined` on the
 * device. The labels were already sitting in the bundle
 * (`lib/i18n/locales/*.json` carries 26 `failureReason.*` entries) — the data
 * was being thrown away one layer below them.
 */
import { describe, expect, it } from "vitest";
import { AgentTaskListSchema } from "@/data/schemas";

const base = {
  id: "t1",
  agent_id: "a1",
  runtime_id: "r1",
  issue_id: "i1",
  created_at: "2026-09-29T00:00:00Z",
  status: "failed",
};

function reasonOf(raw: unknown): unknown {
  const [task] = AgentTaskListSchema.parse([{ ...base, failure_reason: raw }]);
  return task.failure_reason;
}

describe("AgentTaskSchema failure_reason", () => {
  // The exact observed losses, in live frequency order. Each of these is a
  // canonical value the server writes today; each used to reach the UI as
  // `undefined`, turning a named cause into a bare "Failed".
  it.each([
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
    // Values outside the canonical 22 that the server also writes, and that
    // web's `FAILURE_REASON_I18N_KEYS` already names.
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
    // Coarse pre-MUL-1949 value still on historical rows.
    "agent_error",
    "manual",
  ])("keeps %s instead of collapsing it to undefined", (reason) => {
    expect(reasonOf(reason)).toBe(reason);
  });

  it("keeps a reason this build has never heard of", () => {
    // The open-string guarantee. A newer server adding a reason must reach the
    // UI intact so `failureReasonLabel` can degrade to the raw value — that is
    // exactly what web does, and it is strictly more honest than "Failed".
    expect(reasonOf("agent_error.some_future_classification")).toBe(
      "agent_error.some_future_classification",
    );
  });

  it("still normalizes the backend's empty-string sentinel to undefined", () => {
    // Preserved deliberately: `""` means "not failed" (Go `omitempty` on a
    // custom string enum), and every downstream truthy check relies on it
    // being absent rather than an empty string.
    expect(reasonOf("")).toBeUndefined();
  });

  it("still tolerates a missing field and an explicit null", () => {
    // The parse must not gain a new failure mode: non-failed tasks omit the
    // field entirely, and some rows carry an explicit null.
    expect(reasonOf(undefined)).toBeUndefined();
    expect(reasonOf(null)).toBeUndefined();
  });

  it("still tolerates a non-string value without dropping the row", () => {
    // Enum drift downgrades, never crashes (root CLAUDE.md). A malformed value
    // costs the row its reason, not its existence.
    const [task] = AgentTaskListSchema.parse([
      { ...base, failure_reason: { unexpected: true } },
    ]);
    expect(task.id).toBe("t1");
    expect(task.failure_reason).toBeUndefined();
  });
});
