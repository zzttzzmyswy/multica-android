// @vitest-environment node
/**
 * The cheap pre-check that decides whether a move asks before writing
 * (MUL-7420, MYS-2743).
 *
 * Two properties carry the weight here, and both are mutation-guarded below
 * because getting either wrong silently restores the defect this iteration
 * removes:
 *
 *   1. `apply` may only come from a POSITIVE "this column keeps the assignee".
 *      An unread or unloaded workflow must refuse, never apply — folding
 *      "could not read" into "no handoff" is the failure this repo has shipped
 *      three times (iterations 251, 254, 256).
 *   2. A column that DOES hand off must ask, even though the server may still
 *      answer "no handoff" for this particular issue. The dialog decides that;
 *      the pre-check must not pre-empt it.
 */
import { describe, expect, it } from "vitest";
import type { IssueWorkflow, IssueWorkflowStep, Project } from "@multica/core/types";
import { qualifiesForHandoffGate } from "./handoff-gate";

const manual = (status_key: string): IssueWorkflowStep => ({
  status_key,
  handler: { type: "none" },
  instructions: "",
});

const handoff = (status_key: string): IssueWorkflowStep => ({
  status_key,
  handler: { type: "agent", id: "agent-1" },
  instructions: "do the thing",
});

const defaultWorkflow: IssueWorkflow = {
  id: "wf-default",
  workspace_id: "ws-1",
  name: "Default",
  description: "",
  is_default: true,
  owner_id: null,
  steps: ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"].map(manual),
  project_ids: [],
  created_at: "",
  updated_at: "",
};

/** Default, but `in_progress` hands off. */
const handoffWorkflow: IssueWorkflow = {
  ...defaultWorkflow,
  id: "wf-handoff",
  name: "Content",
  is_default: false,
  steps: [
    manual("backlog"),
    manual("todo"),
    handoff("in_progress"),
    manual("in_review"),
    manual("blocked"),
    manual("done"),
    manual("cancelled"),
  ],
};

/** Lists only todo / done — so a move into it can land on an unlisted status. */
const narrowHandoffWorkflow: IssueWorkflow = {
  ...defaultWorkflow,
  id: "wf-narrow",
  name: "Narrow",
  is_default: false,
  steps: [manual("todo"), handoff("in_progress"), manual("done")],
};

const project = (id: string, workflow_id: string | null): Project =>
  ({ id, title: id, workflow_id }) as Project;

const base = {
  workflowState: "ready" as const,
  projects: [project("p-default", null), project("p-handoff", "wf-handoff"), project("p-narrow", "wf-narrow")],
};

describe("status changes", () => {
  it("applies without asking when the destination column keeps the assignee", () => {
    expect(
      qualifiesForHandoffGate({
        ...base,
        issue: { status: "todo", project_id: "p-default" },
        target: { kind: "status", status: "in_review" },
        workflows: [defaultWorkflow, handoffWorkflow],
      }),
    ).toBe("apply");
  });

  it("asks when the destination column hands off", () => {
    expect(
      qualifiesForHandoffGate({
        ...base,
        issue: { status: "todo", project_id: "p-handoff" },
        target: { kind: "status", status: "in_progress" },
        workflows: [defaultWorkflow, handoffWorkflow],
      }),
    ).toBe("confirm");
  });

  it("applies when the status is unchanged — nothing moves, nothing hands off", () => {
    expect(
      qualifiesForHandoffGate({
        ...base,
        issue: { status: "in_progress", project_id: "p-handoff" },
        target: { kind: "status", status: "in_progress" },
        workflows: [defaultWorkflow, handoffWorkflow],
      }),
    ).toBe("apply");
  });

  it("uses DEFAULT for an issue in no project", () => {
    // A project-less issue is limited by Default, so Default's (handler-free)
    // steps decide; the named workflow's handler is irrelevant here.
    expect(
      qualifiesForHandoffGate({
        ...base,
        issue: { status: "todo", project_id: null },
        target: { kind: "status", status: "in_progress" },
        workflows: [defaultWorkflow, handoffWorkflow],
      }),
    ).toBe("apply");
  });
});

describe("the read-failure rule", () => {
  it("MUTATION GUARD: a FAILED workflow read refuses, it does not apply", () => {
    // The defect class: folding "could not read" into "no handoff" makes the
    // phone reassign silently while believing it verified something.
    expect(
      qualifiesForHandoffGate({
        ...base,
        workflowState: "failed",
        issue: { status: "todo", project_id: "p-handoff" },
        target: { kind: "status", status: "in_progress" },
        workflows: undefined,
      }),
    ).toBe("refuse");
  });

  it("refuses while the workflow read is still in flight", () => {
    expect(
      qualifiesForHandoffGate({
        ...base,
        workflowState: "pending",
        issue: { status: "todo", project_id: "p-handoff" },
        target: { kind: "status", status: "in_progress" },
        workflows: undefined,
      }),
    ).toBe("refuse");
  });

  it("refuses a FAILED read even when a stale workflow list is still around", () => {
    // `workflows` present + state failed is a real combination (a refetch that
    // errored over warm cache). The state, not the presence of data, decides.
    expect(
      qualifiesForHandoffGate({
        ...base,
        workflowState: "failed",
        issue: { status: "todo", project_id: "p-handoff" },
        target: { kind: "status", status: "in_progress" },
        workflows: [defaultWorkflow, handoffWorkflow],
      }),
    ).toBe("refuse");
  });

  it("refuses while the issue itself is unknown", () => {
    expect(
      qualifiesForHandoffGate({
        ...base,
        issue: null,
        target: { kind: "status", status: "in_progress" },
        workflows: [defaultWorkflow],
      }),
    ).toBe("refuse");
  });
});

describe("project moves", () => {
  it("asks when the destination workflow hands off the column the issue lands on", () => {
    expect(
      qualifiesForHandoffGate({
        ...base,
        issue: { status: "in_progress", project_id: null },
        target: { kind: "project", projectId: "p-handoff", projectTitle: "handoff" },
        workflows: [defaultWorkflow, handoffWorkflow],
      }),
    ).toBe("confirm");
  });

  it("applies when the destination workflow is administrative", () => {
    expect(
      qualifiesForHandoffGate({
        ...base,
        issue: { status: "in_progress", project_id: null },
        target: { kind: "project", projectId: "p-default", projectTitle: "default" },
        workflows: [defaultWorkflow, handoffWorkflow],
      }),
    ).toBe("apply");
  });

  it("asks when the move could land on ANY column of a workflow that hands off", () => {
    // The issue's status is not in the destination workflow, so it lands on a
    // column the client cannot name — `projectMoveMayHandOff` then answers
    // "some column does", which must ask rather than assume.
    expect(
      qualifiesForHandoffGate({
        ...base,
        issue: { status: "in_review", project_id: null },
        target: { kind: "project", projectId: "p-narrow", projectTitle: "narrow" },
        workflows: [defaultWorkflow, narrowHandoffWorkflow],
      }),
    ).toBe("confirm");
  });

  it("refuses when the destination project is not in the list", () => {
    // The project list has not answered (or the id is stale): "cannot tell" is
    // a refusal, not an assumption that the move is administrative.
    expect(
      qualifiesForHandoffGate({
        ...base,
        issue: { status: "in_progress", project_id: null },
        target: { kind: "project", projectId: "p-unknown", projectTitle: "?" },
        workflows: [defaultWorkflow],
      }),
    ).toBe("refuse");
  });

  it("refuses while the project list is not loaded", () => {
    expect(
      qualifiesForHandoffGate({
        ...base,
        projects: undefined,
        issue: { status: "in_progress", project_id: null },
        target: { kind: "project", projectId: "p-handoff", projectTitle: "handoff" },
        workflows: [defaultWorkflow, handoffWorkflow],
      }),
    ).toBe("refuse");
  });
});
