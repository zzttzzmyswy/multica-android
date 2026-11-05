// @vitest-environment node
/**
 * Workflow write refusals: recognised, and nothing else is.
 *
 * The risk this file guards is asymmetric. Missing a refusal means the user
 * sees a developer sentence — annoying. Claiming a refusal where there is none
 * means a real failure (403, 500, a validation error) gets reported as "this
 * status isn't in the workflow", which sends the user to fix something that is
 * not broken. Hence the "leaves every other failure alone" cases below: they
 * are the load-bearing half.
 */
import { describe, expect, it } from "vitest";
import { workflowWriteRefusal } from "./workflow-write-refusal";

const failure = (status: number, body: unknown) => ({ status, body });

describe("workflowWriteRefusal", () => {
  it("reads the status_not_in_workflow refusal with its allowed list", () => {
    // Shape taken from the deployed server:
    // server/internal/handler/issue_workflow_entry.go writeIssueWorkflowError.
    expect(
      workflowWriteRefusal(
        failure(400, {
          error: 'status "drafting" is not in workflow "Content"',
          code: "status_not_in_workflow",
          workflow_name: "Content",
          allowed_statuses: ["todo", "in_progress", "done"],
        }),
      ),
    ).toEqual({
      kind: "status_not_in_workflow",
      workflowName: "Content",
      allowedStatuses: ["todo", "in_progress", "done"],
    });
  });

  it("reads the workflow_step_moved refusal with both statuses", () => {
    expect(
      workflowRefusalStepMoved(),
    ).toEqual({
      kind: "workflow_step_moved",
      step: "in_progress",
      currentStatus: "in_review",
    });
  });

  it("tolerates a refusal whose optional fields are missing", () => {
    // Older or newer servers may drop fields; the refusal must still be
    // recognised, or the user gets the developer sentence instead.
    expect(
      workflowWriteRefusal(failure(400, { code: "status_not_in_workflow" })),
    ).toEqual({
      kind: "status_not_in_workflow",
      workflowName: "",
      allowedStatuses: [],
    });
  });

  it("leaves every other failure alone", () => {
    // Each of these is a real, differently-caused failure. Reporting any of
    // them as a workflow refusal would send the user to fix the wrong thing.
    expect(workflowWriteRefusal(failure(403, { error: "forbidden" }))).toBeNull();
    expect(workflowWriteRefusal(failure(500, { error: "boom" }))).toBeNull();
    expect(
      workflowWriteRefusal(failure(409, { code: "revision_conflict" })),
    ).toBeNull();
    expect(
      workflowWriteRefusal(failure(400, { code: "invalid_assignee" })),
    ).toBeNull();
  });

  it("leaves failures with no body, or a non-object body, alone", () => {
    expect(workflowWriteRefusal(failure(400, undefined))).toBeNull();
    expect(workflowWriteRefusal(failure(400, null))).toBeNull();
    expect(workflowWriteRefusal(failure(400, "status_not_in_workflow"))).toBeNull();
    expect(workflowWriteRefusal(new Error("network"))).toBeNull();
    expect(workflowWriteRefusal(null)).toBeNull();
  });

  it("ignores a status code alone — the body's code is the signal", () => {
    // A 400 carrying an unrelated code must not be read as a workflow
    // refusal merely because the HTTP status matches.
    expect(
      workflowWriteRefusal(failure(400, { code: "something_else", status: 400 })),
    ).toBeNull();
  });
});

/** Split out so the assertion above reads as data, not as a wall of braces. */
function workflowRefusalStepMoved() {
  return workflowWriteRefusal(
    failure(409, {
      error: "the issue moved on from the step this run was working on",
      code: "workflow_step_moved",
      step: "in_progress",
      current_status: "in_review",
    }),
  );
}
