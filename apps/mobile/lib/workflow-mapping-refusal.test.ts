// @vitest-environment node
/**
 * `projectWorkflowWriteRefusal` — the 409 reader behind the switch's recovery
 * path (MYS-2690).
 *
 * The shape under test is the server's: `writeMappingRequired`
 * (`server/internal/handler/issue_workflow.go:596`) writes
 * `{error, code, plan}` with HTTP 409. Both halves are load-bearing — the CODE
 * is what separates this refusal from the endpoint's other conflict, and the
 * PLAN is what the dialog needs to re-open with rows the user can satisfy.
 */
import { describe, expect, it } from "vitest";
import { projectWorkflowWriteRefusal } from "./workflow-mapping-refusal";

/** `ApiError`'s shape, built without importing `@/data/api`: that module pulls
 *  React Native in at import time, which the Node lane cannot parse. The
 *  reader is duck-typed on `.body` for exactly this reason — the same split
 *  `lib/workflow-write-refusal.test.ts` uses. */
class FakeApiError extends Error {
  readonly status: number;
  readonly body?: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

const serverBody = (overrides: Record<string, unknown> = {}) => ({
  error: 'choose a destination status for the 2 issue(s) on "drafting"',
  code: "workflow_status_mapping_required",
  plan: {
    required: [
      { status_key: "drafting", issue_count: 2, suggested_status_key: "todo" },
    ],
    unchanged: [{ status_key: "todo", issue_count: 5 }],
    total_issues: 7,
    affected_issues: 2,
  },
  ...overrides,
});

const conflict = (body: unknown) =>
  new FakeApiError("workflow_status_mapping_required", 409, body);

describe("projectWorkflowWriteRefusal", () => {
  it("reads the plan out of the server's 409 body", () => {
    const refusal = projectWorkflowWriteRefusal(conflict(serverBody()));
    expect(refusal).not.toBeNull();
    expect(refusal?.kind).toBe("mapping_required");
    expect(refusal?.plan.required).toEqual([
      { status_key: "drafting", issue_count: 2, suggested_status_key: "todo" },
    ]);
    expect(refusal?.plan.unchanged).toEqual([{ status_key: "todo", issue_count: 5 }]);
    expect(refusal?.plan.affected_issues).toBe(2);
    expect(refusal?.detail).toContain("drafting");
  });

  it("needs the CODE, not just a 409", () => {
    // The same endpoint has a second conflict source — a lost update on the
    // project row — with nothing to map. Matching on the status alone would
    // re-open a mapping dialog for a race the user cannot resolve that way.
    expect(
      projectWorkflowWriteRefusal(
        conflict({ error: "revision mismatch", plan: serverBody().plan }),
      ),
    ).toBeNull();
    expect(projectWorkflowWriteRefusal(conflict({ code: "something_else" }))).toBeNull();
  });

  it("declines a refusal that names no status", () => {
    // Re-opening the dialog on an empty plan gives the user a confirm button
    // and nothing to fill in — the write would fail again with the same code.
    // An ordinary failure report is the honest outcome.
    const empty = serverBody({
      plan: { required: [], unchanged: [], total_issues: 3, affected_issues: 0 },
    });
    expect(projectWorkflowWriteRefusal(conflict(empty))).toBeNull();
    expect(
      projectWorkflowWriteRefusal(conflict(serverBody({ plan: undefined }))),
    ).toBeNull();
  });

  it("leaves every other failure on the generic channel", () => {
    const forbidden = new FakeApiError(
      "only workspace admins and the project lead can change this project's workflow",
      403,
      { error: "only workspace admins…" },
    );
    expect(projectWorkflowWriteRefusal(forbidden)).toBeNull();
    expect(projectWorkflowWriteRefusal(new FakeApiError("Network request failed", 0))).toBeNull();
    expect(projectWorkflowWriteRefusal(new Error("boom"))).toBeNull();
    expect(projectWorkflowWriteRefusal(null)).toBeNull();
    expect(projectWorkflowWriteRefusal(undefined)).toBeNull();
  });

  it("normalises a partially drifted plan instead of throwing", () => {
    // A body missing counts must still produce rows the dialog can render:
    // 0 issues and an empty suggestion are both safe (the suggestion only
    // pre-selects; `defaultStatusMapping` falls back to the target's first).
    const drifted = serverBody({
      plan: {
        required: [{ status_key: "drafting" }, null, { issue_count: 4 }, "nonsense"],
        unchanged: [{ issue_count: 2 }],
      },
    });
    const refusal = projectWorkflowWriteRefusal(conflict(drifted));
    expect(refusal?.plan.required).toEqual([
      { status_key: "drafting", issue_count: 0, suggested_status_key: "" },
    ]);
    expect(refusal?.plan.unchanged).toEqual([]);
    expect(refusal?.plan.total_issues).toBe(0);
  });
});
