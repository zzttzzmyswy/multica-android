// @vitest-environment node
/**
 * The workflow card's row model (MYS-2889).
 *
 * Five things are pinned here, in order of how expensive they are to get
 * wrong. The first three are the failure modes this repository has already paid
 * for once; the last two are specific to this card.
 *
 *   1. **A failed read is not "no workflow".** The card must not vanish when
 *      the read fails — vanishing asserts that the project runs no pipeline,
 *      which the client does not know. Upstream's `if (!workflow) return null`
 *      is right for a settled cache and wrong for a phone that reads its own.
 *   2. **An issue outside any project shows no card at all.** Falling back to
 *      the workspace Default would describe a pipeline the issue does not
 *      travel; the server applies no project workflow outside a project.
 *   3. **At most one current row, and possibly none.** A status the workflow
 *      does not list (a project that switched workflows underneath its issues)
 *      must highlight nothing rather than pick a column.
 *   4. **The hint is the gate's decision.** Every row's hint comes from
 *      `handoffHint` → `stepHandsOff`, the predicate the handoff gate reads, so
 *      the card cannot promise a handoff the write would not perform.
 *   5. **Order and identity are the workflow's own.** The rows are the
 *      workflow's steps in order, keyed by their real `status_key` — the card
 *      is a view of the pipeline, not a re-derivation of it.
 */
import { describe, expect, it } from "vitest";
import type {
  IssueWorkflow,
  IssueWorkflowHandlerType,
  IssueWorkflowStep,
  Project,
} from "@multica/core/types";
import { stepHandsOff } from "./workflow";
import {
  buildWorkflowCard,
  currentStep,
  currentStepCount,
  workflowCardState,
  type WorkflowCardProject,
} from "./workflow-card";

const step = (
  status_key: string,
  type: IssueWorkflowHandlerType = "none",
  id?: string,
): IssueWorkflowStep => ({
  status_key,
  handler: id ? { type, id } : { type },
  instructions: "",
});

const workflowOf = (
  steps: IssueWorkflowStep[],
  overrides: Partial<IssueWorkflow> = {},
): IssueWorkflow => ({
  id: "wf-1",
  workspace_id: "ws-1",
  name: "Delivery",
  description: "",
  is_default: false,
  owner_id: null,
  steps,
  project_ids: [],
  created_at: "",
  updated_at: "",
  ...overrides,
});

const project = (
  overrides: Partial<WorkflowCardProject> = {},
): WorkflowCardProject => ({
  id: "p-1",
  title: "Apollo",
  lead_type: null,
  lead_id: null,
  workflow_id: null,
  ...overrides,
});

/** The live Default pipeline's shape: the five fixed columns plus two middles. */
const PIPELINE = workflowOf([
  step("backlog"),
  step("todo"),
  step("in_progress", "agent", "agent-1"),
  step("in_review", "project_lead"),
  step("blocked"),
  step("done"),
  step("cancelled"),
]);

/** The workspace Default, a separate row with its own (shorter) pipeline. */
const DEFAULT_WORKFLOW = workflowOf([step("todo"), step("done")], {
  id: "wf-default",
  name: "Default",
  is_default: true,
});

describe("workflowCardState — the four states (MYS-2889)", () => {
  it("draws the card once the read settles and the project is known", () => {
    const state = workflowCardState({
      workflows: [PIPELINE],
      state: "ready",
      projectId: "p-1",
      project: project({ workflow_id: "wf-1" }),
      currentStatus: "todo",
    });
    expect(state.kind).toBe("card");
  });

  it("draws NOTHING for an issue outside any project", () => {
    // Upstream: `IssueWorkflowPropRow` passes projectId into
    // `useProjectWorkflow`, which answers null for a null id. Mobile must not
    // substitute the Default — see the module doc's rule 1.
    //
    // The fixture carries a REAL Default workflow on purpose. With no Default
    // in the list, a fallback mutation would find nothing and return `hidden`
    // anyway, so the test would pass while the defect was fully present: an
    // issue outside a project would silently claim the Default pipeline.
    for (const projectId of [null, undefined]) {
      expect(
        workflowCardState({
          workflows: [DEFAULT_WORKFLOW, PIPELINE],
          state: "ready",
          projectId,
          project: undefined,
          currentStatus: "todo",
        }).kind,
        `projectId ${String(projectId)}`,
      ).toBe("hidden");
    }
  });

  it("does not fall back to the Default for a project whose workflow is gone", () => {
    // The dangling-reference case: the project names a workflow that is not in
    // the list. `resolveProjectWorkflow` treats that as Default (which is what
    // the server does), so the card must show the DEFAULT's columns — not the
    // named one's, and not nothing.
    const state = workflowCardState({
      workflows: [DEFAULT_WORKFLOW, PIPELINE],
      state: "ready",
      projectId: "p-1",
      project: project({ workflow_id: "wf-deleted" }),
      currentStatus: "todo",
    });
    expect(state.kind).toBe("card");
    expect(state.kind === "card" && state.card.workflowName).toBe("Default");
  });

  it("does not vanish when the read FAILED — it reports the failure", () => {
    // The repository's recurring defect: an absent value presented as a
    // measured one. `hidden` here would claim "this project runs no workflow".
    const state = workflowCardState({
      workflows: undefined,
      state: "failed",
      projectId: "p-1",
      project: project({ workflow_id: "wf-1" }),
      currentStatus: "todo",
    });
    expect(state.kind).toBe("failed");
    expect(state.kind).not.toBe("hidden");
  });

  it("reports a FAILED read even when the project row has not arrived yet", () => {
    // Guard order matters: `failed` must be checked before the project-row
    // gap, or a failure would be downgraded to "still loading" — a spinner
    // that never resolves instead of an error with a retry.
    expect(
      workflowCardState({
        workflows: undefined,
        state: "failed",
        projectId: "p-1",
        project: undefined,
        currentStatus: "todo",
      }).kind,
    ).toBe("failed");
  });

  it("is pending while the workflow read is in flight", () => {
    expect(
      workflowCardState({
        workflows: undefined,
        state: "pending",
        projectId: "p-1",
        project: project(),
        currentStatus: "todo",
      }).kind,
    ).toBe("pending");
  });

  it("is pending while the PROJECT row has not arrived, not hidden", () => {
    // `resolveProjectWorkflow` reads `project.workflow_id`; without the project
    // row it cannot, and answering "no workflow" would be a guess.
    expect(
      workflowCardState({
        workflows: [PIPELINE],
        state: "ready",
        projectId: "p-1",
        project: undefined,
        currentStatus: "todo",
      }).kind,
    ).toBe("pending");
  });

  it("is hidden when a settled read resolves no workflow at all", () => {
    // A workspace on a server without workflows: `resolveProjectWorkflow`
    // answers null from an empty list, and that IS a measured absence.
    expect(
      workflowCardState({
        workflows: [],
        state: "ready",
        projectId: "p-1",
        project: project(),
        currentStatus: "todo",
      }).kind,
    ).toBe("hidden");
  });

  it("ignores a projects list entry for a DIFFERENT project", () => {
    // The caller looks the project up by id; a stale row must not stand in.
    expect(
      workflowCardState({
        workflows: [PIPELINE],
        state: "ready",
        projectId: "p-2",
        project: project({ id: "p-1" }),
        currentStatus: "todo",
      }).kind,
    ).toBe("pending");
  });
});

describe("buildWorkflowCard — order, identity, highlight (MYS-2889)", () => {
  it("keeps the workflow's own column order and keys", () => {
    const card = buildWorkflowCard(PIPELINE, project(), "todo");
    expect(card.steps.map((s) => s.statusKey)).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "blocked",
      "done",
      "cancelled",
    ]);
    expect(card.workflowName).toBe("Delivery");
    expect(card.projectTitle).toBe("Apollo");
  });

  it("marks exactly the issue's own column", () => {
    const card = buildWorkflowCard(PIPELINE, project(), "in_progress");
    expect(currentStepCount(card)).toBe(1);
    expect(currentStep(card)?.statusKey).toBe("in_progress");
  });

  it("marks at most ONE row even when the read repeats a column", () => {
    // A stale cache could carry a duplicate step. Evaluating
    // `status_key === currentStatus` per row would light up both and make the
    // card claim the issue is in two places.
    const duplicated = workflowOf([
      step("todo"),
      step("in_progress"),
      step("in_progress"),
      step("done"),
    ]);
    const card = buildWorkflowCard(duplicated, project(), "in_progress");
    expect(currentStepCount(card)).toBe(1);
    // The FIRST occurrence is the anchor.
    expect(card.steps.filter((s) => s.current).map((s) => s.statusKey)).toEqual([
      "in_progress",
    ]);
    expect(card.steps.findIndex((s) => s.current)).toBe(1);
  });

  it("marks NOTHING when the issue sits on a column the workflow dropped", () => {
    // Reachable: a project switches workflows and its issues stay on a status
    // the new one does not list (`workflowStatusOptions` re-adds it to the
    // picker for this reason). Picking a column would be a lie.
    const card = buildWorkflowCard(PIPELINE, project(), "drafting");
    expect(currentStepCount(card)).toBe(0);
    expect(currentStep(card)).toBeUndefined();
  });

  it("marks nothing when the issue has no status yet", () => {
    for (const status of [null, undefined]) {
      expect(buildWorkflowCard(PIPELINE, project(), status).steps.some((s) => s.current)).toBe(
        false,
      );
    }
  });
});

describe("buildWorkflowCard — each row's hint is the gate's decision (MYS-2889)", () => {
  it("gives a column the same hint the status picker would", () => {
    const lead = project({ lead_type: "member", lead_id: "user-9" });
    const card = buildWorkflowCard(PIPELINE, lead, "todo");
    const byKey = new Map(card.steps.map((s) => [s.statusKey, s]));

    // `agent` with an id → that actor.
    expect(byKey.get("in_progress")?.hint).toEqual({
      kind: "actor",
      actor: { type: "agent", id: "agent-1" },
    });
    // `project_lead` → the project's lead, named up front.
    expect(byKey.get("in_review")?.hint).toEqual({
      kind: "projectLead",
      actor: { type: "member", id: "user-9" },
    });
    // `none` → nothing to say.
    expect(byKey.get("todo")?.hint).toBeNull();
  });

  it("draws a hint exactly on the rows that hand off — no more, no less", () => {
    // The equivalence, over every handler shape the type allows. This is what
    // stops the card growing its own reading of `handler.type`: mutate either
    // side and this fails.
    const shapes: { type: IssueWorkflowHandlerType; id?: string }[] = [
      { type: "none" },
      { type: "agent", id: "agent-1" },
      { type: "agent" },
      { type: "squad", id: "squad-1" },
      { type: "squad" },
      { type: "member", id: "user-1" },
      { type: "member" },
      { type: "project_lead" },
      { type: "creator" },
    ];
    const steps = shapes.map((shape, index) =>
      step(`col-${index}`, shape.type, shape.id),
    );
    const wf = workflowOf(steps);
    const lead = project({ lead_type: "agent", lead_id: "agent-lead" });
    const card = buildWorkflowCard(wf, lead, null);

    card.steps.forEach((row, index) => {
      const source = steps[index]!;
      expect(row.hint !== null, `${source.handler.type} with id ${source.handler.id ?? "—"}`).toBe(
        stepHandsOff(source),
      );
    });
  });

  it("keeps hinting the actor on the CURRENT column too", () => {
    // Deliberate divergence from the status picker, where the current row shows
    // no hint: there, a hint means "choosing this row reassigns", and the row
    // you are already on reassigns nothing. Here the card is a MAP of the
    // pipeline — "entering in_progress hands it to Ada" stays true and useful
    // while the issue sits in in_progress, and dropping it would make the
    // current row the one row that cannot tell you what it does.
    const card = buildWorkflowCard(PIPELINE, project(), "in_progress");
    expect(currentStep(card)?.hint).not.toBeNull();
  });
});

describe("the card carries the rows the editor needs (MYS-2889 follow-up)", () => {
  // The handoff editor needs the workflow's `id`, `owner_id`, `is_default` and
  // `project_ids`, plus the project it was opened from. Carrying them on the
  // card means one resolution produces both the display and the edit target; a
  // second `resolveProjectWorkflow` in the component could disagree with this
  // one if a project row landed between the two reads, and the editor would
  // then be editing a workflow the sheet is not showing.
  it("exposes the resolved workflow ROW, not just its name", () => {
    const card = buildWorkflowCard(PIPELINE, project(), "todo");
    expect(card.workflow).toBe(PIPELINE);
    expect(card.workflow.id).toBe(PIPELINE.id);
  });

  it("exposes the project row the copy scope and the brief preview name", () => {
    const p = project();
    const card = buildWorkflowCard(PIPELINE, p, "todo");
    expect(card.project).toBe(p);
  });

  it("still builds a card with no project row, using an empty stand-in", () => {
    // Unreachable through `workflowCardState` (it guards a resolved project),
    // but `buildWorkflowCard` is exported and must not throw for a direct
    // caller. An empty id is the honest answer: there is no project to scope to.
    const card = buildWorkflowCard(PIPELINE, null, "todo");
    expect(card.project.id).toBe("");
    expect(card.steps.length).toBe(PIPELINE.steps.length);
  });
});
