/**
 * Workspace-level mutations (update details / leave / delete). Semantics
 * mirror packages/core/workspace/mutations.ts + the settings workspace-tab
 * flows (packages/views/settings/components/workspace-tab.tsx), adapted for
 * mobile:
 *
 *   - `useUpdateWorkspace` invalidates `["workspaces"]` on BOTH success and
 *     failure. The whole app derives the workspace name/slug from that single
 *     cache (tab header, switch-workspace, select-workspace), so a confirmed
 *     rename must re-read server truth everywhere; an ambiguous transport
 *     failure may have committed upstream, so a reconcile refetch is cheap
 *     and correct either way.
 *
 *   - `useLeaveWorkspace` / `useDeleteWorkspace` are fired from a
 *     confirmation dialog, each then invalidate the list. The caller awaits
 *     the mutation BEFORE navigating (mobile/CLAUDE.md: flows that navigate
 *     must await the server; no optimistic removal), clears the workspace
 *     store, and routes to /select-workspace — the store clear matters
 *     because ApiClient.fetch injects X-Workspace-Slug from it, and a stale
 *     slug after leave/delete would leak into later requests.
 *
 * No optimistic patching of the workspace row: the server's returned
 * Workspace is authoritative (the iteration-24 lesson — patch with the
 * response object, not the request), but since the list query re-reads the
 * canonical rows after invalidation, callers get truth without duplicating
 * the patch logic.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type UpdateWorkspaceRequest } from "@/data/api";
import { workspaceListOptions } from "@/data/queries/workspaces";

export function useUpdateWorkspace() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      workspaceId,
      patch,
    }: {
      workspaceId: string;
      patch: UpdateWorkspaceRequest;
    }) => api.updateWorkspace(workspaceId, patch),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: workspaceListOptions().queryKey });
    },
  });
}

export function useLeaveWorkspace() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (workspaceId: string) => api.leaveWorkspace(workspaceId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: workspaceListOptions().queryKey });
    },
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (workspaceId: string) => api.deleteWorkspace(workspaceId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: workspaceListOptions().queryKey });
    },
  });
}