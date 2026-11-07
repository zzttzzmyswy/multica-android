// @vitest-environment node
/**
 * Project workflow binding — the pure predicates behind the property row and
 * the switch flow (MYS-2690).
 *
 * Every case below is transcribed from the upstream code it mirrors, not
 * invented here:
 *
 *   - `packages/views/workflows/permissions.ts` — who may switch a project's
 *     workflow. Its own rule is one line, and the three ways to get it wrong
 *     (role-only, lead-only, lead-not-checked-for-member) are all exercised.
 *   - `packages/views/workflows/project-workflow-row.tsx` — the `null`-for-
 *     Default transformation, the "nothing changed" short-circuit, and the
 *     `status_mapping`-only-when-required rule.
 *   - `packages/views/workflows/workflow-mapping-dialog.tsx` — the pre-filled
 *     mapping and its completeness gate.
 *   - `server/internal/handler/issue_workflow.go` — the plan shape and the
 *     `affected_issues` total.
 *
 * These modules are hand-copies of rules that live somewhere else, which is
 * exactly the kind that drifts quietly. A divergence here means the phone and
 * the desktop disagree about who may change a project's pipeline, or the phone
 * sends a write the server refuses.
 */
import { describe, expect, it } from "vitest";
import type { IssueWorkflow, IssueWorkflowMappingPlan } from "@multica/core/types";
import {
  canManageProjectWorkflow,
  defaultStatusMapping,
  mappingAffectedIssues,
  mappingNeedsChoice,
  mappingRequirements,
  mappingUnchangedIssues,
  projectWorkflowChoiceChanges,
  projectWorkflowIdFor,
  statusMappingComplete,
  statusMappingPayload,
  workflowsProjectNames,
} from "./project-workflow";

const columns = (...middle: string[]) =>
  ["backlog", "todo", ...middle, "blocked", "done", "cancelled"].map(
    (status_key) => ({ status_key, handler: { type: "none" as const }, instructions: "" }),
  );

const defaultWorkflow: IssueWorkflow = {
  id: "wf-default",
  workspace_id: "ws-1",
  name: "Default",
  description: "",
  is_default: true,
  owner_id: null,
  steps: columns("in_progress", "in_review"),
  project_ids: ["p-default"],
  created_at: "",
  updated_at: "",
};

const contentWorkflow: IssueWorkflow = {
  ...defaultWorkflow,
  id: "wf-content",
  name: "Content",
  is_default: false,
  owner_id: "user-owner",
  steps: columns("drafting", "editing"),
  project_ids: ["p-content", "p-gone"],
};

const plan = (partial: Partial<IssueWorkflowMappingPlan> = {}): IssueWorkflowMappingPlan => ({
  required: [],
  unchanged: [],
  total_issues: 0,
  affected_issues: 0,
  ...partial,
});

describe("canManageProjectWorkflow (MUL-7420, mirrors the server)", () => {
  it("lets owners and admins manage any project", () => {
    for (const role of ["owner", "admin"]) {
      expect(
        canManageProjectWorkflow({
          project: { lead_type: "agent", lead_id: "agent-1" },
          currentUserId: "user-me",
          currentRole: role,
        }),
      ).toBe(true);
    }
  });

  it("lets the project's member lead manage its own project", () => {
    expect(
      canManageProjectWorkflow({
        project: { lead_type: "member", lead_id: "user-me" },
        currentUserId: "user-me",
        currentRole: "member",
      }),
    ).toBe(true);
  });

  it("refuses a plain member who does not lead the project", () => {
    expect(
      canManageProjectWorkflow({
        project: { lead_type: "member", lead_id: "user-someone-else" },
        currentUserId: "user-me",
        currentRole: "member",
      }),
    ).toBe(false);
    expect(
      canManageProjectWorkflow({
        project: null,
        currentUserId: "user-me",
        currentRole: "member",
      }),
    ).toBe(false);
  });

  it("refuses a project led by an AGENT, even when the ids match", () => {
    // The server compares `project.lead_id` against the caller's USER id and
    // additionally requires `lead_type == "member"` (`issue_workflow.go:55`).
    // Dropping the type test would grant management to anyone whose user id
    // happened to equal an agent's id — the rule would read as "the lead,
    // whoever that is", which is not the rule.
    expect(
      canManageProjectWorkflow({
        project: { lead_type: "agent", lead_id: "user-me" },
        currentUserId: "user-me",
        currentRole: "member",
      }),
    ).toBe(false);
  });

  it("refuses while the role or the user is unknown", () => {
    expect(
      canManageProjectWorkflow({
        project: { lead_type: "member", lead_id: "user-me" },
        currentUserId: null,
        currentRole: null,
      }),
    ).toBe(false);
    // A resolved user id is enough for the lead branch even when the member
    // list has not landed — the lead fact is on the project, not the roster.
    expect(
      canManageProjectWorkflow({
        project: { lead_type: "member", lead_id: "user-me" },
        currentUserId: "user-me",
        currentRole: null,
      }),
    ).toBe(true);
  });
});

describe("projectWorkflowIdFor — null means Default, never 'unchanged'", () => {
  it("sends null for the Default workflow and its id for any other", () => {
    expect(projectWorkflowIdFor(defaultWorkflow)).toBeNull();
    expect(projectWorkflowIdFor(contentWorkflow)).toBe("wf-content");
  });

  it("treats a project with no workflow as already on Default", () => {
    // The field is absent from older servers' responses; `undefined` must read
    // as Default, or picking Default would look like a change every time.
    expect(
      projectWorkflowChoiceChanges({
        project: { workflow_id: null },
        workflow: defaultWorkflow,
      }),
    ).toBe(false);
    expect(
      projectWorkflowChoiceChanges({
        project: { workflow_id: undefined },
        workflow: defaultWorkflow,
      }),
    ).toBe(false);
  });

  it("changes when the project moves between Default and a named workflow", () => {
    expect(
      projectWorkflowChoiceChanges({
        project: { workflow_id: null },
        workflow: contentWorkflow,
      }),
    ).toBe(true);
    expect(
      projectWorkflowChoiceChanges({
        project: { workflow_id: "wf-content" },
        workflow: defaultWorkflow,
      }),
    ).toBe(true);
  });

  it("does not change when the project picks the workflow it already uses", () => {
    expect(
      projectWorkflowChoiceChanges({
        project: { workflow_id: "wf-content" },
        workflow: contentWorkflow,
      }),
    ).toBe(false);
  });
});

describe("dry-run plan (server contract: IssueWorkflowMappingPlan)", () => {
  const withRequired = plan({
    required: [
      { status_key: "drafting", issue_count: 2, suggested_status_key: "in_progress" },
      { status_key: "editing", issue_count: 1, suggested_status_key: "in_review" },
    ],
    unchanged: [{ status_key: "todo", issue_count: 3 }],
    total_issues: 6,
    affected_issues: 3,
  });

  it("knows when the switch needs the user to choose", () => {
    expect(mappingNeedsChoice(plan())).toBe(false);
    expect(mappingNeedsChoice(null)).toBe(false);
    expect(mappingNeedsChoice(withRequired)).toBe(true);
  });

  it("counts the issues that move and the ones that stay", () => {
    expect(mappingAffectedIssues(withRequired)).toBe(3);
    expect(mappingUnchangedIssues(withRequired)).toBe(3);
    expect(mappingAffectedIssues(null)).toBe(0);
    expect(mappingUnchangedIssues(null)).toBe(0);
  });

  it("sums the required rows when a drifted body omits affected_issues", () => {
    // A parse defaults `affected_issues` to 0. Trusting it would print
    // "Switch and update 0 issues" while moving three.
    expect(mappingAffectedIssues({ ...withRequired, affected_issues: 0 })).toBe(3);
  });

  it("keeps the server's order for the required rows", () => {
    expect(mappingRequirements(withRequired).map((r) => r.status_key)).toEqual([
      "drafting",
      "editing",
    ]);
    expect(mappingRequirements(null)).toEqual([]);
  });
});

describe("defaultStatusMapping (mirrors workflow-mapping-dialog.tsx)", () => {
  const required = plan({
    required: [
      { status_key: "drafting", issue_count: 2, suggested_status_key: "in_progress" },
      { status_key: "editing", issue_count: 1, suggested_status_key: "in_review" },
    ],
    affected_issues: 3,
  });
  const target = [
    "backlog",
    "todo",
    "in_progress",
    "in_review",
    "blocked",
    "done",
    "cancelled",
  ];

  it("pre-fills each required status with its suggestion", () => {
    expect(defaultStatusMapping(required, target)).toEqual({
      drafting: "in_progress",
      editing: "in_review",
    });
  });

  it("falls back to the target's first status when the suggestion is gone", () => {
    // A drifted body can suggest a status the target workflow no longer lists.
    // Leaving the row blank would kill the confirm button with nothing on
    // screen explaining why.
    expect(defaultStatusMapping(required, ["todo", "done"])).toEqual({
      drafting: "todo",
      editing: "todo",
    });
  });

  it("is empty when nothing needs mapping", () => {
    expect(defaultStatusMapping(plan(), target)).toEqual({});
    expect(defaultStatusMapping(null, target)).toEqual({});
  });

  it("counts a blank destination as incomplete, so the write cannot be sent", () => {
    expect(statusMappingComplete(required, { drafting: "todo" })).toBe(false);
    expect(statusMappingComplete(required, { drafting: "todo", editing: "done" })).toBe(
      true,
    );
    // Nothing required is trivially complete.
    expect(statusMappingComplete(plan(), {})).toBe(true);
  });
});

describe("statusMappingPayload (mirrors project-workflow-row.tsx:76)", () => {
  const required = plan({
    required: [
      { status_key: "drafting", issue_count: 2, suggested_status_key: "todo" },
      { status_key: "editing", issue_count: 1, suggested_status_key: "done" },
    ],
    affected_issues: 3,
  });

  it("sends only the statuses the plan requires", () => {
    expect(
      statusMappingPayload(required, {
        drafting: "todo",
        editing: "done",
        somethingElse: "cancelled",
      }),
    ).toEqual({ drafting: "todo", editing: "done" });
  });

  it("omits the field entirely when nothing needs moving", () => {
    // Upstream sends `undefined` rather than `{}`. The distinction matters to
    // the next reader: an empty mapping on a non-empty plan is the silent
    // variant of "the write was refused".
    expect(statusMappingPayload(plan(), { drafting: "todo" })).toBeUndefined();
    expect(statusMappingPayload(null, {})).toBeUndefined();
  });

  it("drops a required status the caller left blank instead of sending an empty target", () => {
    // The server's checkMapping refuses `""` with a sentence naming a raw key;
    // `statusMappingComplete` is what keeps this state from being submitted at
    // all. The payload stays honest if it ever is.
    expect(statusMappingPayload(required, { drafting: "todo" })).toEqual({
      drafting: "todo",
    });
  });
});

describe("workflowsProjectNames (mirrors project-workflow-row.tsx:104)", () => {
  const projects = [
    { id: "p-default", title: "Alpha", workflow_id: null },
    { id: "p-default-2", title: "Beta", workflow_id: null },
    { id: "p-content", title: "Gamma", workflow_id: "wf-content" },
    // Deleted elsewhere: still named by the workflow row until it refetches.
    { id: "p-gone", title: "Delta", workflow_id: "wf-content" },
  ];

  it("names every project that uses a named workflow", () => {
    // Delta is listed on the row (this build's copy of it) even though the
    // project list still shows it pointing at wf-content — both facts agree,
    // so both names print.
    expect(workflowsProjectNames({ workflow: contentWorkflow, projects })).toEqual([
      "Gamma",
      "Delta",
    ]);
  });

  it("counts the projects that name NO workflow for Default", () => {
    expect(workflowsProjectNames({ workflow: defaultWorkflow, projects })).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("intersects the workflow's project_ids with the project list", () => {
    // Both sides can be stale, and the rule is a two-way intersection: a
    // project the row names but the list has dropped is never printed (no
    // "Used by: <deleted project>"), and a project the list points at but the
    // row does not name is not claimed either. That is upstream's
    // `workflow.project_ids.includes(p.id)` (project-workflow-row.tsx:104);
    // the row stays the authority because it is what the server groups usage
    // by (`projectIDsByWorkflow`, issue_workflow.go:151).
    const namesADeletedProject = {
      ...contentWorkflow,
      project_ids: ["p-content", "p-deleted"],
    };
    // Delta still points at wf-content, but the row no longer names it.
    expect(
      workflowsProjectNames({ workflow: namesADeletedProject, projects }),
    ).toEqual(["Gamma"]);
  });

  it("returns nothing while the project list is unknown", () => {
    // "Used by nobody" is an assertion; it may only be made once the list has
    // resolved. An empty array here is NOT that assertion — the caller pairs it
    // with the read state.
    expect(workflowsProjectNames({ workflow: contentWorkflow, projects: undefined })).toEqual(
      [],
    );
  });
});
