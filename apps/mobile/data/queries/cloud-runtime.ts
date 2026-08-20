/**
 * Cloud runtime node queries (iteration-82, A2.2) — workspace-scoped nodes
 * proxied to multica-cloud. Mirrors packages/core/runtimes/cloud-runtime.ts
 * bound to mobile's ApiClient. `cloudRuntimeNodeListOptions` polls every 5s
 * while any node is in a pending state (launching/starting/…) so the dialog
 * livens up without a manual refresh, and settles to stale-time otherwise.
 *
 * A 503 response ("cloud runtime is not configured") is not surfaced here:
 * the dialog reads the query error and degrades to an explanatory card. The
 * ApiError.status survives for that check.
 */
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CloudRuntimeNode,
  CreateCloudRuntimeNodeRequest,
} from "@multica/core/runtimes";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";
import { isCloudRuntimeNodePending } from "@/lib/cloud-runtime-node";

export const cloudRuntimeKeys = {
  all: (wsId: string | null) => ["cloud-runtime", wsId] as const,
  nodes: (wsId: string | null) =>
    [...cloudRuntimeKeys.all(wsId), "nodes"] as const,
};

export const cloudRuntimeNodeListOptions = (
  wsId: string | null,
  params?: { limit?: number; offset?: number },
) => {
  const limit = params?.limit ?? 20;
  const offset = params?.offset ?? 0;
  return queryOptions({
    queryKey: [...cloudRuntimeKeys.nodes(wsId), { limit, offset }] as const,
    queryFn: () =>
      api.listCloudRuntimeNodes({ limit, offset }).then((nodes) => {
        // Sort newest-first like web's dialog (created_at desc) so the list
        // is stable across refetches even when the backend omits ordering.
        return [...nodes].sort(
          (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
        );
      }),
    enabled: !!wsId,
    refetchInterval: (query) =>
      query.state.data?.some((node) => isCloudRuntimeNodePending(node.status))
        ? 5000
        : false,
    staleTime: 15 * 1000,
  });
};

export function useCreateCloudRuntimeNode() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: (data: CreateCloudRuntimeNodeRequest) =>
      api.createCloudRuntimeNode(data),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: cloudRuntimeKeys.all(wsId) });
    },
  });
}

export function useDeleteCloudRuntimeNode() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: (instanceId: string) => api.deleteCloudRuntimeNode(instanceId),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: cloudRuntimeKeys.all(wsId) });
    },
  });
}