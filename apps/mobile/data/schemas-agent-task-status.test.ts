/**
 * `AgentTask.status` vocabulary (iteration 265).
 *
 * This is a FACT bug, not a wording one: the server's CHECK constraint has
 * carried `deferred` since migration 128
 * (`server/migrations/128_comment_routing_escalation.up.sql`), the retry path
 * writes it (`CreateRetryTask` → status `deferred` + `fire_at`, see
 * `server/internal/service/retry_deferred_test.go`), and
 * `ListTasksByIssue` filters on nothing but `issue_id` — so a deferred row
 * really does reach the issue's task-runs response. The schema's enum did not
 * name it and ended in `.catch("queued")`, so the device relabelled a real,
 * different status as another one.
 *
 * What that cost, concretely: web gives `deferred` its own row tone
 * (`execution-log-section.tsx`, `text-warning`) and leaves it out of its run
 * count (`tasks.filter(t => t.status !== "deferred")`), because a parked retry
 * has not been run. Mobile could not make that distinction at all — the state
 * was gone by the time any screen saw it.
 */
import { describe, expect, it } from "vitest";
import { AgentTaskListSchema } from "@/data/schemas";

const base = {
  id: "t1",
  agent_id: "a1",
  runtime_id: "r1",
  issue_id: "i1",
  created_at: "2026-09-29T00:00:00Z",
};

describe("AgentTaskSchema status", () => {
  it("keeps a deferred task deferred instead of rewriting it to queued", () => {
    // The exact regression: `{"status":"deferred"}` used to parse to
    // `{"status":"queued"}`, so "waiting out a retry backoff" rendered as
    // "waiting in line" — and landed in the Active section of the runs sheet.
    const [task] = AgentTaskListSchema.parse([{ ...base, status: "deferred" }]);
    expect(task.status).toBe("deferred");
  });

  it("still degrades a status this build cannot name to queued", () => {
    // The `.catch` is the API-compatibility path and must survive the enum
    // widening: a status added by a newer server degrades to queued (a
    // non-terminal, visible state) rather than dropping the row.
    const [task] = AgentTaskListSchema.parse([
      { ...base, status: "some_future_status" },
    ]);
    expect(task.status).toBe("queued");
  });

  it("names every status the server's CHECK constraint allows", () => {
    // Migration 128 lists exactly these eight. A value missing here is a value
    // the client silently rewrites, so the enum is asserted as a set rather
    // than one status at a time.
    const allowed = [
      "queued",
      "dispatched",
      "running",
      "completed",
      "failed",
      "cancelled",
      "waiting_local_directory",
      "deferred",
    ];
    for (const status of allowed) {
      const [task] = AgentTaskListSchema.parse([{ ...base, status }]);
      expect(task.status, `${status} must survive the parse`).toBe(status);
    }
  });
});

describe("AgentTaskSchema wakeup_id", () => {
  it("parses a wakeup-launched task's rule id", () => {
    // The second half of the "is this issue still going to be worked on" test
    // for a deferred task, read by core's isQueuedTaskStatus. Undeclared, it
    // was passed through only because the object is `.loose()` — untested and
    // invisible to the type.
    const [task] = AgentTaskListSchema.parse([
      { ...base, status: "deferred", wakeup_id: "w-1" },
    ]);
    expect(task.wakeup_id).toBe("w-1");
  });

  it("leaves it undefined when the task has no wakeup behind it", () => {
    // Absent on every task no rule started (verified on the wire). The
    // predicate depends on that distinction: deferred WITHOUT a wakeup is not
    // on its way to running.
    const [task] = AgentTaskListSchema.parse([{ ...base, status: "deferred" }]);
    expect(task.wakeup_id).toBeUndefined();
  });
});
