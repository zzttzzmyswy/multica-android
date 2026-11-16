import { describe, expect, it, vi } from "vitest";

// The hook binds `@/data/api` and the workspace store, both of which reach
// native modules at import time. This lane only asserts the pure decisions.
vi.mock("@/data/api", () => ({ api: {} }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import type { IssueWorkflow, ListIssueWorkflowsResponse } from "@multica/core/types";
import {
  handoffCacheEffect,
  handoffCopyInvalidationKeys,
  patchWorkflowInList,
} from "./workflow-handoff";

/**
 * The handoff save's cache contract (MYS-2889 follow-up).
 *
 * These tests exist because the two branches are indistinguishable from the
 * outside: both show "saved", and only the NEXT render tells you whether the
 * cache was updated correctly. The failure modes are concrete:
 *
 *   - patching after a copy → the project still points at the old workflow on
 *     screen, so the user's next look says the save did nothing;
 *   - patching a drifted body → the cache entry for the workflow the user did
 *     NOT edit is overwritten with an empty row.
 */

function workflow(id: string, name = id, stepHandler = "none"): IssueWorkflow {
  return {
    id,
    workspace_id: "ws-1",
    name,
    description: "",
    is_default: false,
    owner_id: null,
    steps: [{ status_key: "in_progress", handler: { type: stepHandler as "none" }, instructions: "" }],
    project_ids: [],
    created_at: "",
    updated_at: "",
  };
}

describe("handoffCacheEffect", () => {
  it("patches the edited row when the same workflow came back", () => {
    const saved = workflow("wf-1");
    expect(
      handoffCacheEffect({ editedWorkflowId: "wf-1", copyForProjectId: undefined, saved }),
    ).toEqual({ kind: "patch", workflow: saved });
  });

  it("invalidates the copy branch when the server answered with a NEW row", () => {
    expect(
      handoffCacheEffect({
        editedWorkflowId: "wf-1",
        copyForProjectId: "p-pay",
        saved: workflow("wf-2", "Delivery (Payments)"),
      }),
    ).toEqual({ kind: "invalidateCopy", copyProjectId: "p-pay" });
  });

  it("trusts copyForProjectId even when the body failed to parse", () => {
    // A drifted body parses to EMPTY_ISSUE_WORKFLOW (id ""). Deciding on the id
    // alone would take the patch branch and write an EMPTY row over the cache
    // entry of the workflow the user did NOT edit.
    expect(
      handoffCacheEffect({
        editedWorkflowId: "wf-1",
        copyForProjectId: "p-pay",
        saved: { ...workflow(""), steps: [], name: "" },
      }),
    ).toEqual({ kind: "invalidateCopy", copyProjectId: "p-pay" });
  });

  it("returns no effect when a plain save's body drifted", () => {
    // Nothing to patch, and no copy to repoint — the caller invalidates.
    expect(
      handoffCacheEffect({
        editedWorkflowId: "wf-1",
        copyForProjectId: undefined,
        saved: { ...workflow(""), steps: [] },
      }),
    ).toBeNull();
  });

  it("returns no effect when no body came back at all", () => {
    expect(
      handoffCacheEffect({ editedWorkflowId: "wf-1", copyForProjectId: undefined, saved: null }),
    ).toBeNull();
    // A copy with no project id cannot be narrowed, so the caller invalidates.
    expect(
      handoffCacheEffect({ editedWorkflowId: "wf-1", copyForProjectId: undefined, saved: workflow("wf-2") }),
    ).toBeNull();
  });
});

describe("patchWorkflowInList", () => {
  const list: ListIssueWorkflowsResponse = {
    workflows: [workflow("wf-default", "Default"), workflow("wf-1", "Delivery"), workflow("wf-2", "Content")],
    total: 3,
  };

  it("replaces one row and keeps the list's order", () => {
    // The project picker renders the list in the server's order; a patch that
    // appended would reorder it on every handoff save.
    const updated = { ...workflow("wf-1", "Delivery"), description: "changed" };
    const out = patchWorkflowInList(list, updated)!;
    expect(out.workflows.map((w) => w.id)).toEqual(["wf-default", "wf-1", "wf-2"]);
    expect(out.workflows[1]!.description).toBe("changed");
    expect(out.total).toBe(3);
  });

  it("is a no-op for a row the cache does not hold", () => {
    const out = patchWorkflowInList(list, workflow("wf-99"));
    expect(out).toBe(list);
  });

  it("is a no-op for an absent cache rather than inventing a list", () => {
    expect(patchWorkflowInList(undefined, workflow("wf-1"))).toBeUndefined();
  });
});

describe("handoffCopyInvalidationKeys", () => {
  it("covers the new row, the project's pointer, and the board's badges", () => {
    const keys = handoffCopyInvalidationKeys("ws-1", "p-pay");
    expect(keys).toEqual([
      ["issue-workflows", "ws-1"],
      ["projects", "ws-1", "list"],
      ["projects", "ws-1", "detail", "p-pay"],
      ["issues", "ws-1"],
    ]);
  });
});
