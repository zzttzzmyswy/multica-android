/**
 * Wiring guard for iteration 270's run-outcome surface.
 *
 * `lib/task-outcome.test.ts` proves the classifiers decide correctly, and
 * `data/schemas-agent-task-failure-reason.test.ts` proves the reasons survive
 * the parse. Neither proves the row actually calls them — and "a pure function
 * and its unit tests are fully in place but product code has zero consumers"
 * is a failure mode this project has already paid for once (iteration 247's
 * runtime-registration error). This file pins the wiring, not the decisions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROW = readFileSync(
  join(__dirname, "..", "components", "issue", "run-row.tsx"),
  "utf8",
);

describe("run row wiring", () => {
  it("classifies a stopped run as a stop rather than a failure", () => {
    // Without this call a failed row whose reason is `cancelled` renders
    // "Failed · Cancelled by the system" — both halves of a contradiction.
    expect(ROW).toContain("isCancelledOutcome(task)");
  });

  it("labels the outcome through the shared helper", () => {
    expect(ROW).toContain("runOutcomeLabel(task, t)");
  });

  it("surfaces the raw error for failures a retry cannot fix", () => {
    // Web shows `task.error` for the action-required set instead of hiding it
    // behind hover, which a phone does not have.
    expect(ROW).toContain("failureNeedsAction(task)");
    expect(ROW).toContain("task.error.trim()");
  });

  it("keeps the action-required error out of rows it does not apply to", () => {
    // The gate has to be the predicate, not the presence of `error`: a
    // transient timeout also carries error text, and printing it on every
    // failed row would bury the rows that need attention.
    expect(ROW).toMatch(/failureNeedsAction\(task\)\s*&&\s*task\.error\?\.trim\(\)/);
  });
});
