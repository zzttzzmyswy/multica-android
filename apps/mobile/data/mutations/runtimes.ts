/**
 * Runtime management mutations (iteration-51) — visibility flip, custom
 * rename, and delete (with the unbind-agents cascade). Mirrors web
 * `packages/core/runtimes/mutations.ts`. No optimistic patching: the server
 * response is authoritative (visibility PATCH returns the updated runtime;
 * unbind-agents-and-delete returns the unbound/cancelled counts; delete
 * navigates the detail screen away). Every mutation settles with an
 * invalidate of the runtime list cache — the browse list and the detail
 * screen both read `runtimeListOptions`, so one invalidate refreshes both.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/data/api";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { agentKeys } from "@/data/queries/agents";
import { agentTaskSnapshotOptions } from "@/data/queries/agent-task-snapshot";
import { useWorkspaceStore } from "@/data/workspace-store";

export function useUpdateRuntime() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({
      runtimeId,
      patch,
    }: {
      runtimeId: string;
      patch: {
        visibility?: "private" | "public";
        custom_name?: string;
        apply_to_machine?: boolean;
      };
    }) => api.updateRuntime(runtimeId, patch),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({
        queryKey: runtimeListOptions(wsId).queryKey,
      });
    },
  });
}

export function useDeleteRuntime() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (runtimeId: string) => api.deleteRuntime(runtimeId),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({
        queryKey: runtimeListOptions(wsId).queryKey,
      });
    },
  });
}

export function useUnbindAgentsAndDeleteRuntime() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({
      runtimeId,
      expectedActiveAgentIds,
    }: {
      runtimeId: string;
      expectedActiveAgentIds: string[];
    }) =>
      api.unbindAgentsAndDeleteRuntime(runtimeId, expectedActiveAgentIds),
    onSettled: () => {
      if (!wsId) return;
      qc.invalidateQueries({
        queryKey: runtimeListOptions(wsId).queryKey,
      });
      // Agents get unbound (not just lost), so their runtime column and
      // presence change, and the delete cancels queued/running tasks — mirror
      // web's invalidate set in packages/core/runtimes/mutations.ts.
      void qc.invalidateQueries({ queryKey: agentKeys.list(wsId) });
      void qc.invalidateQueries({ queryKey: agentKeys.listAll(wsId) });
      void qc.invalidateQueries({
        queryKey: agentTaskSnapshotOptions(wsId).queryKey,
      });
    },
  });
}
/**
 * Kick off a daemon self-update (iteration-83, A2.4). Mirrors web's
 * `api.initiateUpdate` trigger inside update-section.tsx — the resulting
 * RuntimeUpdate row is then polled by the component's own 2s loop, so this
 * mutation only fires the POST. On settle the runtime list invalidates: a
 * completed update restarts the daemon, changing status / cli_version.
 */
export function useInitiateRuntimeUpdate() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({ runtimeId, targetVersion }: { runtimeId: string; targetVersion: string }) =>
      api.initiateUpdate(runtimeId, targetVersion),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({
        queryKey: runtimeListOptions(wsId).queryKey,
      });
    },
  });
}
