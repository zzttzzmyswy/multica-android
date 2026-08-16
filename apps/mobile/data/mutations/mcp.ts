/**
 * MCP server mutations.
 *
 * Workspace library writes (create/update/delete): the library list cache is
 * patched with the authoritative server response and invalidated on settle.
 * Deleting a library entry also clears every agent-assignment cache, because
 * the server removes those bindings in the same call.
 *
 * Agent assignment writes (add/toggle/remove) all RETURN the agent's resulting
 * assignment list, so the cache is overwritten with the server's answer —
 * failures surface and the cache re-syncs rather than guessing.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { WorkspaceMcpServer } from "@multica/core/types";
import { api } from "@/data/api";
import { mcpKeys } from "@/data/queries/mcp";
import { useWorkspaceStore } from "@/data/workspace-store";

function useInvalidateMcp(wsId: string | null) {
  const qc = useQueryClient();
  return () => {
    if (!wsId) return;
    void qc.invalidateQueries({ queryKey: mcpKeys.workspace(wsId) });
  };
}

function usePatchMcpList(wsId: string | null) {
  const qc = useQueryClient();
  return (updater: (old: WorkspaceMcpServer[]) => WorkspaceMcpServer[]) => {
    qc.setQueryData<WorkspaceMcpServer[]>(mcpKeys.workspace(wsId), (old) =>
      old ? updater(old) : old,
    );
  };
}

/** Creating a library entry needs the current workspace's id. */
export function useCreateWorkspaceMcpServer() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateMcp(wsId);
  const patchList = usePatchMcpList(wsId);

  return useMutation({
    mutationFn: ({
      name,
      config,
    }: {
      name: string;
      config: Record<string, unknown>;
    }) => api.createWorkspaceMcpServer(wsId ?? "", name, config),
    onSuccess: (server) => {
      if (!server.id) return;
      patchList((old) =>
        old.some((s) => s.id === server.id) ? old : [...old, server],
      );
    },
    onSettled: invalidate,
  });
}

export function useUpdateWorkspaceMcpServer() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateMcp(wsId);
  const patchList = usePatchMcpList(wsId);

  return useMutation({
    mutationFn: ({
      serverId,
      update,
    }: {
      serverId: string;
      update: { name?: string; config?: Record<string, unknown> };
    }) => api.updateWorkspaceMcpServer(wsId ?? "", serverId, update),
    onSuccess: (server) => {
      if (!server.id) return;
      patchList((old) => old.map((s) => (s.id === server.id ? server : s)));
    },
    onSettled: invalidate,
  });
}

export function useDeleteWorkspaceMcpServer() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateMcp(wsId);
  const patchList = usePatchMcpList(wsId);

  return useMutation({
    mutationFn: (serverId: string) =>
      api.deleteWorkspaceMcpServer(wsId ?? "", serverId),
    onSuccess: (_void, serverId) => {
      patchList((old) => old.filter((s) => s.id !== serverId));
      // The server also removes every agent binding to this entry — drop any
      // cached assignment lists so the agent tab re-syncs.
      void qc.invalidateQueries({ queryKey: ["agents"] });
    },
    onSettled: invalidate,
  });
}

// --- Agent assignments (bound to a concrete agent) ---

function useAgentMcpInvalidate(agentId: string) {
  const qc = useQueryClient();
  return () => {
    if (!agentId) return;
    void qc.invalidateQueries({ queryKey: mcpKeys.agent(agentId) });
  };
}

/** Every agent write returns the resulting list — write it straight to cache. */
function useAgentMcpReplace(agentId: string) {
  const qc = useQueryClient();
  return (servers: WorkspaceMcpServer[]) => {
    if (!agentId) return;
    qc.setQueryData<WorkspaceMcpServer[]>(mcpKeys.agent(agentId), servers);
  };
}

export function useAddAgentMcpServer(agentId: string) {
  const invalidate = useAgentMcpInvalidate(agentId);
  const replace = useAgentMcpReplace(agentId);

  return useMutation({
    mutationFn: (serverId: string) => api.addAgentMcpServer(agentId, serverId),
    onSuccess: replace,
    onSettled: invalidate,
  });
}

export function useSetAgentMcpServerEnabled(agentId: string) {
  const qc = useQueryClient();
  const invalidate = useAgentMcpInvalidate(agentId);
  const replace = useAgentMcpReplace(agentId);

  return useMutation({
    mutationFn: ({ serverId, enabled }: { serverId: string; enabled: boolean }) =>
      api.setAgentMcpServerEnabled(agentId, serverId, enabled),
    // The toggle flips instantly; the server's returned list reconciles on
    // success and we roll back to the cached state on failure.
    onMutate: async ({ serverId, enabled }) => {
      const key = mcpKeys.agent(agentId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<WorkspaceMcpServer[]>(key);
      qc.setQueryData<WorkspaceMcpServer[]>(key, (old) =>
        old ? old.map((s) => (s.id === serverId ? { ...s, enabled } : s)) : old,
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData<WorkspaceMcpServer[]>(mcpKeys.agent(agentId), context.previous);
      }
    },
    onSuccess: replace,
    onSettled: invalidate,
  });
}

export function useRemoveAgentMcpServer(agentId: string) {
  const invalidate = useAgentMcpInvalidate(agentId);
  const replace = useAgentMcpReplace(agentId);

  return useMutation({
    mutationFn: (serverId: string) => api.removeAgentMcpServer(agentId, serverId),
    onSuccess: replace,
    onSettled: invalidate,
  });
}