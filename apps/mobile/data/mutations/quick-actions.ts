/**
 * Quick-action mutations (iteration-52) — create / update / delete. Mirrors
 * packages/core/quick-actions/mutations.ts bound to mobile's ApiClient and
 * workspace store. No optimistic patching: the server canonicalizes values
 * (position, prompt trim, derived visibility, last_used_at) and the settings
 * rows render from the refetched catalog, so a round-trip is acceptable.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateQuickActionRequest,
  UpdateQuickActionRequest,
} from "@multica/core/types";
import { api } from "@/data/api";
import { quickActionKeys } from "@/data/queries/quick-actions";
import { useWorkspaceStore } from "@/data/workspace-store";

export function useCreateQuickAction() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: CreateQuickActionRequest) =>
      api.createQuickAction(data),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: quickActionKeys.all(wsId) });
    },
  });
}

export function useUpdateQuickAction() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: { id: string } & UpdateQuickActionRequest) =>
      api.updateQuickAction(id, data),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: quickActionKeys.all(wsId) });
    },
  });
}

export function useDeleteQuickAction() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.deleteQuickAction(id),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: quickActionKeys.all(wsId) });
    },
  });
}