/**
 * Batch project mutations for the projects-list multi-select toolbar (web
 * projects-page ProjectBatchToolbar parity). Pin/unpin reuse the existing
 * optimistic pin mutations per row; delete walks the same optimistic list
 * patch as useDeleteProject (snapshot → filter → settle invalidate) but for
 * an id set, so a mid-batch failure restores the whole list.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Project, PinnedItemType } from "@multica/core/types";
import { api } from "@/data/api";
import { projectKeys } from "@/data/queries/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useCreatePin, useDeletePin } from "@/data/mutations/pins";

export function useBatchPinToggle() {
  const createPin = useCreatePin();
  const deletePin = useDeletePin();

  return {
    isPending: createPin.isPending || deletePin.isPending,
    pin: (projectId: string) =>
      createPin.mutate({ item_type: "project" as PinnedItemType, item_id: projectId }),
    unpin: (projectId: string) =>
      deletePin.mutate({ itemType: "project" as PinnedItemType, itemId: projectId }),
  };
}

export function useBatchDeleteProjects() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: async (projectIds: string[]) => {
      for (const id of projectIds) {
        await api.deleteProject(id);
      }
    },
    onMutate: async (projectIds: string[]) => {
      const listKey = projectKeys.list(wsId);
      await qc.cancelQueries({ queryKey: listKey });
      const prevList = qc.getQueryData<Project[]>(listKey);
      const ids = new Set(projectIds);
      qc.setQueryData<Project[]>(listKey, (old) =>
        old ? old.filter((p) => !ids.has(p.id)) : old,
      );
      return { prevList, listKey };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevList !== undefined) {
        qc.setQueryData(ctx.listKey, ctx.prevList);
      }
    },
    onSettled: (_d, _e, projectIds: string[] | undefined) => {
      for (const id of projectIds ?? []) {
        qc.removeQueries({ queryKey: projectKeys.detail(wsId, id) });
        qc.removeQueries({ queryKey: projectKeys.resources(wsId, id) });
      }
      void qc.invalidateQueries({ queryKey: projectKeys.list(wsId) });
    },
  });
}
