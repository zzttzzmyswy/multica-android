/**
 * Workspace repository mutations (iteration-52).
 *
 * Web stores repositories INSIDE the Workspace object — PATCH
 * `/api/workspaces/:id { repos }` — there is no standalone repositories
 * endpoint (server router has none). Mobile mirrors that wire contract: the
 * mutations read the current workspace's `repos` from the workspace-list
 * query cache, add / remove / replace one row, PATCH it, then write the
 * authoritative server response back into the same cache so the list (and
 * the settings entry points) settle without a refetch.
 *
 * Every mutation writes the SERVER's returned workspace back, never a
 * hand-built optimistic value: the server normalizes the array (trims, drops
 * duplicate urls) and the cache has to show what was actually stored.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Workspace, WorkspaceRepo } from "@multica/core/types";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";

const WORKSPACES_KEY = ["workspaces"] as const;

/**
 * Replace the row at `index`, leaving every other row untouched.
 *
 * Pure and exported because it is the part with a silent failure mode: the
 * server has no repo id, so a row is addressed by position, and an
 * off-by-one here rewrites the WRONG repository — which the server accepts
 * happily. Returns `null` when `index` addresses no row (the list shrank
 * under a stale index), which the caller turns into an error rather than a
 * no-op PATCH.
 */
export function replaceRepoAt(
  repos: readonly WorkspaceRepo[],
  index: number,
  repo: WorkspaceRepo,
): WorkspaceRepo[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= repos.length) {
    return null;
  }
  return repos.map((existing, i) => (i === index ? repo : existing));
}

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
 * Replace one repository row in place. Web's repositories tab edits the url
 * and description inline and auto-saves the whole array
 * (`repositories-tab.tsx:263-275` `updateRepository` → `saveRepositories`),
 * because the server has no per-row endpoint: `PATCH /api/workspaces/:id
 * { repos }` replaces the list, and `validateAndNormalizeWorkspaceRepos`
 * rejects an empty url and drops duplicates by url
 * (`server/internal/handler/workspace.go:317-360`).
 *
 * The caller must therefore send a VALID url — an empty one is a 400, not a
 * silent no-op. The screen gates the save button on it; this mutation does
 * not paper over it with a client-side filter, because dropping the row
 * would delete a repository the user only meant to fix.
 *
 * Index-addressed like `useRemoveWorkspaceRepo`: the row's position is its
 * identity on this screen (the server has no repo id).
 */
export function useUpdateWorkspaceRepo() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const patch = workspaceCachePatch(qc);

  return useMutation({
    mutationFn: async ({
      index,
      repo,
    }: {
      index: number;
      repo: WorkspaceRepo;
    }) => {
      if (!wsId) {
        throw new Error("No workspace selected");
      }
      const current = qc
        .getQueryData<Workspace[]>(WORKSPACES_KEY)
        ?.find((w) => w.id === wsId);
      const next = replaceRepoAt(current?.repos ?? [], index, repo);
      if (!next) {
        throw new Error("Repository no longer exists");
      }
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