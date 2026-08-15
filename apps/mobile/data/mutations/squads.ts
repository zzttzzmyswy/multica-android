/**
 * Squad mutations (create / update / archive / member manage). Mirrors the
 * semantics of packages/core/api/client.ts Squad methods backed by the
 * server's own permission checks (canManageSquad in handler/squad.go) —
 * mobile's UI gates write controls with the same rules (lib/squad-guards.ts)
 * but the server is the real gate.
 *
 * Deliberately NO optimistic patching (iteration-24 lesson: patch with the
 * authoritative response object, not the request). Every mutation settles
 * with a `["squads", wsId]` prefix invalidation so the list, detail, member
 * roster and status snapshot all re-read truth; a removal navigates away.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AddSquadMemberRequest,
  CreateSquadRequest,
  RemoveSquadMemberRequest,
  UpdateSquadMemberRoleRequest,
  UpdateSquadRequest,
} from "@multica/core/types";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";

function useInvalidateSquads() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return () => {
    if (!wsId) return;
    void qc.invalidateQueries({ queryKey: ["squads", wsId] });
  };
}

export function useCreateSquad() {
  const invalidate = useInvalidateSquads();
  return useMutation({
    mutationFn: (data: CreateSquadRequest) => api.createSquad(data),
    onSettled: invalidate,
  });
}

export function useUpdateSquad(squadId: string) {
  const invalidate = useInvalidateSquads();
  return useMutation({
    mutationFn: (data: UpdateSquadRequest) => api.updateSquad(squadId, data),
    onSettled: invalidate,
  });
}

export function useDeleteSquad() {
  const invalidate = useInvalidateSquads();
  return useMutation({
    mutationFn: (squadId: string) => api.deleteSquad(squadId),
    onSettled: invalidate,
  });
}

export function useAddSquadMember(squadId: string) {
  const invalidate = useInvalidateSquads();
  return useMutation({
    mutationFn: (data: AddSquadMemberRequest) =>
      api.addSquadMember(squadId, data),
    onSettled: invalidate,
  });
}

export function useRemoveSquadMember(squadId: string) {
  const invalidate = useInvalidateSquads();
  return useMutation({
    mutationFn: (data: RemoveSquadMemberRequest) =>
      api.removeSquadMember(squadId, data),
    onSettled: invalidate,
  });
}

export function useUpdateSquadMemberRole(squadId: string) {
  const invalidate = useInvalidateSquads();
  return useMutation({
    mutationFn: (data: UpdateSquadMemberRoleRequest) =>
      api.updateSquadMemberRole(squadId, data),
    onSettled: invalidate,
  });
}