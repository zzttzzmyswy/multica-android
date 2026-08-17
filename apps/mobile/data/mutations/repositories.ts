/**
 * Workspace repository mutations (iteration-52).
 *
 * Web stores repositories INSIDE the Workspace object — PATCH
 * `/api/workspaces/:id { repos }` — there is no standalone repositories
 * endpoint (server router has none). Mobile mirrors that wire contract: the
 * mutations read the current workspace's `repos` from the workspace-list
 * query cache, append / remove one row, PATCH it, then write the
 * authoritative server response back into the same cache so the list (and
 * the settings entry points) settle without a refetch.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Workspace, WorkspaceRepo } from "@multica/core/types";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";

const WORKSPACES_KEY = ["workspaces"] as const;

function workspaceCachePatch(qc: ReturnType<typeof useQueryClient>) {
  return (updated: Workspace) => {
    qc.setQueryData<Workspace[]>(WORKSPACES_KEY, (old) =>
      old?.map((w) => (w.id === updated.id ? updated : w)) ?? [updated],
    );
  };
}

export function useAddWorkspaceRepo() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const patch = workspaceCachePatch(qc);

  return useMutation({
    mutationFn: async (repo: WorkspaceRepo) => {
      if (!wsId) {
        throw new Error("No workspace selected");
      }
      const current = qc
        .getQueryData<Workspace[]>(WORKSPACES_KEY)
        ?.find((w) => w.id === wsId);
      const next = [...(current?.repos ?? []), repo];
      const updated = await api.updateWorkspace(wsId, { repos: next });
      patch(updated);
      return updated;
    },
  });
}

export function useRemoveWorkspaceRepo() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const patch = workspaceCachePatch(qc);

  return useMutation({
    mutationFn: async (index: number) => {
      if (!wsId) {
        throw new Error("No workspace selected");
      }
      const current = qc
        .getQueryData<Workspace[]>(WORKSPACES_KEY)
        ?.find((w) => w.id === wsId);
      const next = (current?.repos ?? []).filter((_, i) => i !== index);
      const updated = await api.updateWorkspace(wsId, { repos: next });
      patch(updated);
      return updated;
    },
  });
}

/**
 * Batch-append repositories (the GitHub import path). One PATCH for the whole
 * selection — mirrors web's importGitHubRepositories, which merges the picked
 * repos into the existing array and auto-saves once.
 */
export function useMergeWorkspaceRepos() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const patch = workspaceCachePatch(qc);

  return useMutation({
    mutationFn: async (additions: WorkspaceRepo[]) => {
      if (!wsId) {
        throw new Error("No workspace selected");
      }
      if (additions.length === 0) return null;
      const current = qc
        .getQueryData<Workspace[]>(WORKSPACES_KEY)
        ?.find((w) => w.id === wsId);
      const next = [...(current?.repos ?? []), ...additions];
      const updated = await api.updateWorkspace(wsId, { repos: next });
      patch(updated);
      return updated;
    },
  });
}