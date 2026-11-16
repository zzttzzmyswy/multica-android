import { describe, expect, it, vi } from "vitest";

// The hooks bind `@/data/api` and the workspace store, both of which reach
// native modules at import time. This lane asserts the cache contract only.
vi.mock("@/data/api", () => ({ api: {} }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import {
  workflowDeleteInvalidationKeys,
  workflowWriteInvalidationKeys,
} from "./workflow-editor";

/**
 * The cache contract of a workflow edit (iteration 294).
 *
 * A wrong set here is invisible at the moment of the write and visible one
 * render later, as a board whose columns disagree with the workflow that was
 * just saved. The two lists are asserted separately because they differ for a
 * reason: a delete can change a project's `workflow_id`, an edit cannot.
 */
describe("workflowWriteInvalidationKeys", () => {
  it("refreshes the workflow list and the issues the edit may have moved", () => {
    const keys = workflowWriteInvalidationKeys("ws-1");
    expect(keys).toContainEqual(["issue-workflows", "ws-1"]);
    // An edit that drops a column remaps issues onto another status
    // (`remapIssues`), so the issue caches are as stale as the workflow's.
    expect(keys).toContainEqual(issueKeysAll());
  });

  it("does not touch projects on a plain edit", () => {
    // A rename moves no project. Invalidating them would refetch every project
    // row on every keystroke-then-save.
    expect(workflowWriteInvalidationKeys("ws-1")).not.toContainEqual(projectKeysList());
  });
});

describe("workflowDeleteInvalidationKeys", () => {
  it("adds the project list, whose rows point at the deleted workflow", () => {
    const keys = workflowDeleteInvalidationKeys("ws-1");
    expect(keys).toContainEqual(projectKeysList());
    expect(keys).toContainEqual(["issue-workflows", "ws-1"]);
    expect(keys).toContainEqual(issueKeysAll());
  });
});

/** The prefixes the key builders produce, spelled out so this test fails if a
 *  builder is renamed out from under the hooks. */
function issueKeysAll() {
  return ["issues", "ws-1"];
}
function projectKeysList() {
  return ["projects", "ws-1", "list"];
}
