// @vitest-environment node
/**
 * The switch's cache contract (MYS-2690).
 *
 * A project workflow switch is the one write in this app that changes FOUR
 * cache families in a single transaction: the project row, the workflow rows'
 * `project_ids`, and the issues the server remapped. Missing any one of them
 * leaves a screen showing the previous pipeline after a successful switch —
 * the class of bug that reads as "the button did nothing".
 *
 * The hook itself has no renderer in this lane, so the assertion is on the key
 * set it publishes. That is the part a later edit can silently shrink.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/data/api", () => ({ api: {} }));
// The module binds to the workspace store, which loads expo-secure-store at
// import time (a no-op in the Node lane).
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { projectKeys } from "@/data/queries/projects";
import { workflowKeys } from "@/data/queries/workflows";
import { issueKeys } from "@/data/queries/issue-keys";
import { projectWorkflowInvalidationKeys } from "./project-workflow";

describe("project-workflow switch invalidation", () => {
  const wsId = "ws-1";
  const projectId = "p-1";

  it("refreshes the project it changed, both shapes", () => {
    const keys = projectWorkflowInvalidationKeys(wsId, projectId);
    expect(keys).toContainEqual(projectKeys.list(wsId));
    expect(keys).toContainEqual(projectKeys.detail(wsId, projectId));
  });

  it("refreshes EVERY workflow row, not just the chosen one", () => {
    // A switch rewrites `project_ids` on two rows — the one the project left
    // and the one it joined. Invalidating only the target would leave the old
    // workflow's "Used by" line naming a project it no longer has.
    const keys = projectWorkflowInvalidationKeys(wsId, projectId);
    expect(keys).toContainEqual(workflowKeys.all(wsId));
  });

  it("refreshes the issue lists, because the server remapped some", () => {
    // The moved issues changed status inside the same transaction. Their rows
    // live under the issues prefix, which is what the board and list read.
    const keys = projectWorkflowInvalidationKeys(wsId, projectId);
    expect(keys).toContainEqual(issueKeys.all(wsId));
  });

  it("keeps every key workspace-scoped", () => {
    // An unscoped key would leak a switch made in one workspace into another
    // workspace's cache — the rule in the root CLAUDE.md.
    for (const key of projectWorkflowInvalidationKeys(wsId, projectId)) {
      expect(key).toContain(wsId);
    }
  });
});
