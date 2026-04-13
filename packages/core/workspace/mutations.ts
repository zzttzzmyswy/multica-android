import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { workspaceKeys, workspaceListOptions } from "./queries";
import { useWorkspaceStore } from "./index";

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; slug: string; description?: string }) =>
      api.createWorkspace(data),
    onSuccess: (newWs) => {
      // Switch to the newly created workspace immediately
      useWorkspaceStore.getState().switchWorkspace(newWs);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: workspaceKeys.list() });
    },
  });
}

export function useLeaveWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) => api.leaveWorkspace(workspaceId),
    onSuccess: async (_, workspaceId) => {
      const currentWsId = useWorkspaceStore.getState().workspace?.id;
      if (currentWsId === workspaceId) {
        // Left our current workspace — refetch and pick another
        const wsList = await qc.fetchQuery(workspaceListOptions());
        useWorkspaceStore.getState().hydrateWorkspace(wsList);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: workspaceKeys.list() });
    },
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) => api.deleteWorkspace(workspaceId),
    onSuccess: async (_, workspaceId) => {
      const currentWsId = useWorkspaceStore.getState().workspace?.id;
      if (currentWsId === workspaceId) {
        // Deleted our current workspace — refetch and pick another
        const wsList = await qc.fetchQuery(workspaceListOptions());
        useWorkspaceStore.getState().hydrateWorkspace(wsList);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: workspaceKeys.list() });
    },
  });
}
