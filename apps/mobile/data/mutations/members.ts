/**
 * Workspace member mutations (role change / removal / invite). Mirrors the
 * semantics of packages/core/api/client.ts member methods backed by the
 * server's own permission checks — mobile enforces the same coarse guards
 * (self-protection, owner protection) in the UI, but the server is the
 * real gate.
 *
 * Deliberately NO optimistic patching: a role change's authoritative shape
 * is the server's MemberWithUser response (the iteration-24 lesson — patch
 * with the response object, not the request), and a removal navigates away.
 * Both settle with an invalidate of the members list so the row re-reads
 * truth. Only the list cache is invalidated — the row pages read the same
 * `memberListOptions` cache, so a refreshed list refreshes them too.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MemberRole } from "@multica/core/types";
import { api } from "@/data/api";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";

export function useUpdateMemberRole() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({
      memberId,
      role,
    }: {
      memberId: string;
      role: MemberRole;
    }) => api.updateMemberRole(wsId!, memberId, { role }),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: memberListOptions(wsId).queryKey });
    },
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (memberId: string) => api.removeMember(wsId!, memberId),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: memberListOptions(wsId).queryKey });
    },
  });
}

export function useInviteMember() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: MemberRole }) =>
      api.inviteMember(wsId!, { email, role }),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: memberListOptions(wsId).queryKey });
    },
  });
}