/**
 * Workflow management decisions (iteration 294).
 *
 * The editor's rules are transcribed from upstream's
 * `workflow-editor-page.tsx`, and the cases below are the ones whose drift
 * produces a wrong WRITE — the failure mode that survives every read-side
 * test. Each `describe` names the defect it prevents, because a green suite
 * that never says what it protects is how the next round removes the guard.
 */
import { describe, expect, it } from "vitest";
import type { IssueWorkflow, IssueWorkflowStep } from "@multica/core/types";
import {
  addNewStatusColumn,
  addStatusColumn,
  addableStatusKeys,
  boardColumns,
  buildWriteRequest,
  canSaveDraft,
  deleteBlocked,
  draftFrom,
  isDraftDirty,
  listedStatusKeys,
  missingStatusNames,
  moveColumn,
  newWorkflowDraft,
  removeColumn,
  replaceColumnStatus,
  saveNeedsDryRun,
  showsUnsavedNote,
  stepChainKeys,
  toggleOptionalColumn,
  usageProjectIds,
  workflowListState,
  type WorkflowDraft,
} from "./workflow-editor";

function step(statusKey: string, overrides: Partial<IssueWorkflowStep> = {}): IssueWorkflowStep {
  return {
    status_key: statusKey,
    handler: { type: "none" },
    instructions: "",
    ...overrides,
  };
}

function workflow(overrides: Partial<IssueWorkflow> = {}): IssueWorkflow {
  return {
    id: "wf-1",
    workspace_id: "ws-1",
    name: "Delivery",
    description: "how work ships",
    is_default: false,
    owner_id: "user-1",
    steps: [
      step("todo"),
      step("in_progress"),
      step("in_review"),
      step("done"),
      step("cancelled"),
    ],
    project_ids: [],
    created_at: "",
    updated_at: "",
  };
}

function draftWith(patch: Partial<WorkflowDraft>): WorkflowDraft {
  return { ...newWorkflowDraft(), ...patch };
}

describe("draftFrom", () => {
  it("reads the optional columns from the step list, not from a guess", () => {
    const draft = draftFrom({
      name: "Delivery",
      description: "d",
      steps: [step("backlog"), step("todo"), step("in_progress"), step("blocked"), step("done"), step("cancelled")],
    });
    expect(draft.backlog).toBe(true);
    expect(draft.blocked).toBe(true);
    expect(draft.middle.map((c) => ("status_key" in c ? c.status_key : c.id))).toEqual(["in_progress"]);
  });

  it("keeps only handoffs that say something", () => {
    // An entry of `{handler: none, instructions: ""}` for every column would
    // make the draft's dirty flag depend on the saved row's key order.
    const draft = draftFrom({
      name: "Delivery",
      description: "",
      steps: [
        step("todo"),
        step("in_progress", { handler: { type: "agent", id: "agent-1" }, instructions: "go" }),
        step("done"),
        step("cancelled"),
      ],
    });
    expect(Object.keys(draft.handoffs)).toEqual(["in_progress"]);
  });

  it("is not dirty against itself, which is what gets 「保存」 to start disabled", () => {
    const source = workflow();
    const draft = draftFrom(source);
    expect(isDraftDirty(source.id, draft, draftFrom(source))).toBe(false);
  });
});

describe("boardColumns", () => {
  it("pins backlog/todo at the head and blocked/done/cancelled at the tail", () => {
    // The server arranges a workflow this way (`issueworkflow.Arrange`). A
    // client that showed its own order would show one thing before the save
    // and another after the refresh.
    const draft = draftWith({
      backlog: true,
      blocked: true,
      middle: [
        { id: "in_progress", status_key: "in_progress" },
        { id: "in_review", status_key: "in_review" },
      ],
    });
    expect(boardColumns(draft).map((c) => c.status_key)).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "blocked",
      "done",
      "cancelled",
    ]);
  });

  it("drops a fixed status that ended up in the middle instead of moving it", () => {
    // Reachable through `replaceColumnStatus`: a middle column switched to
    // `done`. Rendering it twice would send the server two `done` steps.
    const draft = draftWith({
      backlog: false,
      blocked: false,
      middle: [
        { id: "in_progress", status_key: "in_progress" },
        { id: "done", status_key: "done" },
      ],
    });
    expect(boardColumns(draft).map((c) => c.status_key)).toEqual([
      "todo",
      "in_progress",
      "done",
      "cancelled",
    ]);
  });
});

describe("addableStatusKeys", () => {
  it("offers neither a fixed status nor one already listed", () => {
    const draft = draftWith({
      middle: [{ id: "in_progress", status_key: "in_progress" }],
    });
    expect(
      addableStatusKeys(
        ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled", "qa"],
        draft,
      ),
    ).toEqual(["in_review", "qa"]);
  });
});

describe("moveColumn", () => {
  const draft = draftWith({
    middle: [
      { id: "a", status_key: "a" },
      { id: "b", status_key: "b" },
      { id: "c", status_key: "c" },
    ],
  });

  it("swaps with the neighbour", () => {
    expect(moveColumn(draft, "b", -1).middle.map((c) => c.id)).toEqual(["b", "a", "c"]);
    expect(moveColumn(draft, "b", 1).middle.map((c) => c.id)).toEqual(["a", "c", "b"]);
  });

  it("stops at the ends rather than wrapping", () => {
    // Wrapping would silently reorder the whole list on a tap at the edge.
    expect(moveColumn(draft, "a", -1)).toBe(draft);
    expect(moveColumn(draft, "c", 1)).toBe(draft);
  });
});

describe("removeColumn and replaceColumnStatus", () => {
  it("drops the removed column's handoff with it", () => {
    // Keeping it would re-attach the old handler if the same status is added
    // back later in the same session.
    const draft = draftWith({
      middle: [{ id: "in_progress", status_key: "in_progress" }],
      handoffs: { in_progress: { handler: { type: "agent", id: "a-1" }, instructions: "" } },
    });
    const next = removeColumn(draft, "in_progress");
    expect(next.middle).toEqual([]);
    expect(next.handoffs).toEqual({});
  });

  it("carries the handoff to the status it replaces", () => {
    const draft = draftWith({
      middle: [{ id: "in_progress", status_key: "in_progress" }],
      handoffs: { in_progress: { handler: { type: "agent", id: "a-1" }, instructions: "keep" } },
    });
    const next = replaceColumnStatus(draft, "in_progress", "qa");
    expect(next.middle).toEqual([{ id: "qa", status_key: "qa" }]);
    expect(next.handoffs).toEqual({
      qa: { handler: { type: "agent", id: "a-1" }, instructions: "keep" },
    });
  });
});

describe("new status columns", () => {
  it("keys a created column by its name so the draft stays comparable", () => {
    const draft = addNewStatusColumn(newWorkflowDraft(), "  Deploy  ");
    expect(draft.middle.at(-1)).toEqual({ id: "new:Deploy", new_name: "Deploy" });
  });

  it("refuses a blank name", () => {
    const draft = newWorkflowDraft();
    expect(addNewStatusColumn(draft, "   ")).toBe(draft);
  });

  it("never lists a pending status as a next/back target", () => {
    // It has no key until the save, so naming it would send the server a step
    // that does not exist — a 400 at the end of a long edit.
    const draft = addNewStatusColumn(addStatusColumn(newWorkflowDraft(), "qa"), "Deploy");
    expect(listedStatusKeys(draft)).not.toContain("new:Deploy");
    expect(listedStatusKeys(draft)).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "qa",
      "blocked",
      "done",
      "cancelled",
    ]);
  });

  it("does not add a status twice, and never adds a pinned one", () => {
    // The add list cannot offer either, so this guards a caller that reached
    // past it: the server would store the column twice.
    const draft = addStatusColumn(newWorkflowDraft(), "qa");
    expect(addStatusColumn(draft, "qa")).toBe(draft);
    expect(addStatusColumn(draft, "done")).toBe(draft);
  });

  it("blocks the save for a member, naming the statuses an admin must add", () => {
    // Statuses are shared, so `status_create_forbidden` is a 403 the phone can
    // predict. Blocking with the names is better than a refusal that says
    // "only workspace admins can create statuses" with no list.
    const draft = addNewStatusColumn(newWorkflowDraft(), "Deploy");
    expect(missingStatusNames(draft, false)).toEqual(["Deploy"]);
    expect(missingStatusNames(draft, true)).toEqual([]);
    expect(
      canSaveDraft({ canEdit: true, dirty: true, name: "X", pending: false, missingStatuses: ["Deploy"] }),
    ).toBe(false);
  });
});

describe("canSaveDraft", () => {
  const base = { canEdit: true, dirty: true, name: "Delivery", pending: false, missingStatuses: [] };

  it.each([
    ["no edit permission", { canEdit: false }],
    ["nothing changed", { dirty: false }],
    ["a blank name", { name: "   " }],
    ["a save already in flight", { pending: true }],
    ["a status only an admin can create", { missingStatuses: ["Deploy"] }],
  ])("refuses on %s", (_label, patch) => {
    expect(canSaveDraft({ ...base, ...patch })).toBe(false);
  });

  it("allows a complete edit", () => {
    expect(canSaveDraft(base)).toBe(true);
  });
});

describe("buildWriteRequest", () => {
  it("sends steps in board order, fixed columns included", () => {
    const draft = draftWith({
      backlog: true,
      blocked: false,
      middle: [{ id: "in_progress", status_key: "in_progress" }],
    });
    expect(
      buildWriteRequest({ draft, isDefault: false }).steps?.map((s) =>
        "status_key" in s ? s.status_key : `new:${s.new_status.name}`,
      ),
    ).toEqual(["backlog", "todo", "in_progress", "done", "cancelled"]);
  });

  it("carries a handoff only for columns that can hand off", () => {
    // `savedHandoff` strips instructions from a member step; sending them
    // anyway stores text the server never uses and keeps the form dirty.
    const draft = draftWith({
      middle: [
        { id: "in_progress", status_key: "in_progress" },
        { id: "in_review", status_key: "in_review" },
      ],
      handoffs: {
        in_progress: { handler: { type: "agent", id: "a-1" }, instructions: "build it" },
        in_review: { handler: { type: "member", id: "u-1" }, instructions: "leftover" },
      },
    });
    const steps = buildWriteRequest({ draft, isDefault: false }).steps ?? [];
    expect(steps.find((s) => "status_key" in s && s.status_key === "in_progress")).toEqual({
      status_key: "in_progress",
      handler: { type: "agent", id: "a-1" },
      instructions: "build it",
    });
    expect(steps.find((s) => "status_key" in s && s.status_key === "in_review")).toEqual({
      status_key: "in_review",
      handler: { type: "member", id: "u-1" },
      instructions: "",
    });
  });

  it("drops a next/back target the write does not list", () => {
    // Removing a column can leave a saved `next_status_key` pointing at it.
    // The server validates it (`Validate` → 400); the client must not send it.
    const draft = draftWith({
      middle: [{ id: "in_progress", status_key: "in_progress" }],
      handoffs: {
        in_progress: {
          handler: { type: "agent", id: "a-1" },
          instructions: "",
          next_status_key: "in_review",
          back_status_key: "todo",
        },
      },
    });
    const steps = buildWriteRequest({ draft, isDefault: false }).steps ?? [];
    expect(steps.find((s) => "status_key" in s && s.status_key === "in_progress")).toEqual({
      status_key: "in_progress",
      handler: { type: "agent", id: "a-1" },
      instructions: "",
      back_status_key: "todo",
    });
  });

  it("sends a created status as new_status with its name", () => {
    const draft = addNewStatusColumn(newWorkflowDraft(), "Deploy", "started");
    const steps = buildWriteRequest({ draft, isDefault: false }).steps ?? [];
    expect(steps).toContainEqual({ new_status: { name: "Deploy", category: "started" } });
  });

  it("omits the name for Default, which the server refuses to rename", () => {
    // `issue_workflow.go:706` keeps `current.Name` for Default whatever the
    // body says; sending one reads as a rename that silently did nothing.
    const draft = draftWith({ name: "Renamed" });
    expect(buildWriteRequest({ draft, isDefault: true })).not.toHaveProperty("name");
    expect(buildWriteRequest({ draft, isDefault: false }).name).toBe("Renamed");
  });

  it("trims the name and description", () => {
    const draft = draftWith({ name: "  Delivery  ", description: "  ships work  " });
    const body = buildWriteRequest({ draft, isDefault: false });
    expect(body.name).toBe("Delivery");
    expect(body.description).toBe("ships work");
  });

  it("sends status_mapping only when the caller supplies one", () => {
    const draft = newWorkflowDraft();
    expect(buildWriteRequest({ draft, isDefault: false })).not.toHaveProperty("status_mapping");
    expect(
      buildWriteRequest({ draft, isDefault: false, statusMapping: { qa: "done" } }).status_mapping,
    ).toEqual({ qa: "done" });
  });
});

describe("saveNeedsDryRun", () => {
  it("is false for a brand-new workflow", () => {
    expect(saveNeedsDryRun({ saved: null, draft: newWorkflowDraft() })).toBe(false);
  });

  it("is false for Default, which accepts every status", () => {
    const saved = { is_default: true, steps: [step("todo"), step("qa"), step("done")] };
    expect(saveNeedsDryRun({ saved, draft: draftWith({ blocked: false }) })).toBe(false);
  });

  it("is true when a saved status is no longer listed", () => {
    // The defect: sending the PATCH straight away meets a 409 whose plan the
    // user has never seen, naming statuses they cannot map from memory.
    const saved = { is_default: false, steps: [step("todo"), step("qa"), step("done"), step("cancelled")] };
    expect(saveNeedsDryRun({ saved, draft: draftWith({ blocked: false }) })).toBe(true);
  });

  it("is true when switching a fixed column off drops it", () => {
    // A `blocked` switch is a removal too — checking only the delete button
    // would miss it.
    const saved = {
      is_default: false,
      steps: [step("todo"), step("blocked"), step("done"), step("cancelled")],
    };
    expect(saveNeedsDryRun({ saved, draft: draftWith({ blocked: false }) })).toBe(true);
    expect(saveNeedsDryRun({ saved, draft: draftWith({ blocked: true }) })).toBe(false);
  });
});

describe("deleteBlocked", () => {
  it("refuses Default, which cannot be deleted at all", () => {
    expect(deleteBlocked({ workflow: { is_default: true, project_ids: [] } })).toEqual({
      blocked: true,
      reason: "default",
    });
  });

  it("refuses a workflow a project still uses", () => {
    expect(deleteBlocked({ workflow: { is_default: false, project_ids: ["p-1"] } })).toEqual({
      blocked: true,
      reason: "in_use",
    });
  });

  it("allows an unused named workflow", () => {
    expect(deleteBlocked({ workflow: { is_default: false, project_ids: [] } })).toEqual({
      blocked: false,
      reason: null,
    });
  });
});

describe("usageProjectIds", () => {
  const projects = [
    { id: "p-1", workflow_id: "wf-1" },
    { id: "p-2", workflow_id: null },
    { id: "p-3", workflow_id: "wf-2" },
  ];

  it("reads membership off project_ids for a named workflow", () => {
    expect(usageProjectIds({ is_default: false, project_ids: ["p-1"] }, projects)).toEqual(["p-1"]);
  });

  it("reads Default as every project that names none", () => {
    // Default has no membership list of its own; `project_ids` is empty for it.
    expect(usageProjectIds({ is_default: true, project_ids: [] }, projects)).toEqual(["p-2"]);
  });

  it("answers nothing while the project list is unknown", () => {
    expect(usageProjectIds({ is_default: true, project_ids: [] }, undefined)).toEqual([]);
  });
});

describe("toggling the optional columns", () => {
  it("turns backlog and blocked off without touching the middle", () => {
    const draft = addStatusColumn(newWorkflowDraft(), "qa");
    const next = toggleOptionalColumn(draft, "blocked", false);
    expect(next.blocked).toBe(false);
    expect(next.middle).toEqual(draft.middle);
  });
});

describe("workflowListState", () => {
  it("never reads a FAILED fetch as an empty workspace", () => {
    // The defect this ordering exists to prevent: painting 「还没有工作流」 over
    // a request that never answered invites the reader to create a workflow
    // their workspace already has.
    expect(workflowListState("failed", 0)).toBe("failed");
    expect(workflowListState("failed", 0)).not.toBe("empty");
  });

  it("separates loading from empty", () => {
    expect(workflowListState("pending", 0)).toBe("loading");
  });

  it("reads a successful empty list as empty, and a populated one as ready", () => {
    expect(workflowListState("ready", 0)).toBe("empty");
    expect(workflowListState("ready", 2)).toBe("ready");
  });
});

describe("showsUnsavedNote", () => {
  it("stays quiet on a NEW workflow, which is 'dirty' before anything is typed", () => {
    // The flaw this fixes: 「有未保存的改动」 on an untouched 新建 screen is a
    // statement about the screen, not about the reader's work.
    expect(showsUnsavedNote({ isNew: true, dirty: true, canEdit: true })).toBe(false);
    // The BUTTON stays live — that is `isDraftDirty`'s job, not this one's.
    expect(isDraftDirty(null, newWorkflowDraft(), newWorkflowDraft())).toBe(true);
  });

  it("says so on an existing workflow with real changes", () => {
    expect(showsUnsavedNote({ isNew: false, dirty: true, canEdit: true })).toBe(true);
  });

  it("stays quiet when nothing changed or the reader may not edit", () => {
    expect(showsUnsavedNote({ isNew: false, dirty: false, canEdit: true })).toBe(false);
    expect(showsUnsavedNote({ isNew: false, dirty: true, canEdit: false })).toBe(false);
  });
});

describe("stepChainKeys", () => {
  // This app's catalog uses the seven-value set, where the KEYS are the
  // categories. Web's `StepChain` filters on the four-value lifecycle set and
  // compares against "closed". Getting the translation wrong loses or keeps an
  // end state the other client shows.
  const categoryOf = (key: string) =>
    ["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"].includes(key)
      ? key
      : "todo";

  const steps = [
    "backlog",
    "todo",
    "in_progress",
    "in_review",
    "blocked",
    "done",
    "cancelled",
  ].map((status_key) => ({ status_key }));

  it("keeps 已完成 — web drops only the closed end, not the done one", () => {
    // The defect: reading the filter as "drop the last two chips". `done` is
    // part of the path an issue takes and web shows it.
    expect(stepChainKeys(steps, categoryOf)).toContain("done");
  });

  it("drops 已取消, which is the closed end", () => {
    expect(stepChainKeys(steps, categoryOf)).not.toContain("cancelled");
  });

  it("drops 已阻塞, a side state rather than a step", () => {
    expect(stepChainKeys(steps, categoryOf)).not.toContain("blocked");
  });

  it("keeps the ordinary middle columns in workflow order", () => {
    expect(stepChainKeys(steps, categoryOf)).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "done",
    ]);
  });
});
