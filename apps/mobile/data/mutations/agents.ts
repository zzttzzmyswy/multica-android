/**
 * Agent mutations. Update/archive/restore/env mirror web's
 * agent-detail-page.tsx handlers: on settle the list cache is invalidated so
 * the detail screen (which reads the workspace agent list) re-renders the new
 * state. Not optimistic — the backends on these endpoints are cheap and the
 * detail/actions screens own their local feedback.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateAgentRequest,
  SetAgentSkillsRequest,
  UpdateAgentEnvRequest,
  UpdateAgentRequest,
} from "@multica/core/types";
import { api } from "@/data/api";
import { agentKeys } from "@/data/queries/agents";
import { useWorkspaceStore } from "@/data/workspace-store";

export function useCreateAgent() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: CreateAgentRequest) => api.createAgent(data),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: agentKeys.list(wsId) });
      void qc.invalidateQueries({ queryKey: agentKeys.listAll(wsId) });
    },
  });
}

export function useUpdateAgent(agentId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: UpdateAgentRequest) => api.updateAgent(agentId, data),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: agentKeys.list(wsId) });
      void qc.invalidateQueries({ queryKey: agentKeys.listAll(wsId) });
    },
  });
}

export function useArchiveAgent() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (agentId: string) => api.archiveAgent(agentId),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: agentKeys.list(wsId) });
      void qc.invalidateQueries({ queryKey: agentKeys.listAll(wsId) });
    },
  });
}

export function useRestoreAgent() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (agentId: string) => api.restoreAgent(agentId),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: agentKeys.list(wsId) });
      void qc.invalidateQueries({ queryKey: agentKeys.listAll(wsId) });
    },
  });
}

export function useCancelAgentTasks() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (agentId: string) => api.cancelAgentTasks(agentId),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: agentKeys.list(wsId) });
      void qc.invalidateQueries({ queryKey: agentKeys.listAll(wsId) });
      // Presence (drives this action's visibility) and the activity panels
      // read the task snapshot / task / activity queries — refresh them so
      // the cancelled work leaves "Now" and the menu item disappears.
      void qc.invalidateQueries({ queryKey: ["agent-task-snapshot", wsId] });
      void qc.invalidateQueries({ queryKey: ["agent-tasks", wsId] });
      void qc.invalidateQueries({ queryKey: ["agent-activity", wsId] });
    },
  });
}

export function useUpdateAgentEnv(agentId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: UpdateAgentEnvRequest) =>
      api.updateAgentEnv(agentId, data),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: agentKeys.env(agentId) });
      if (!wsId) return;
      // Refresh the agent's custom_env_key_count shown on the env screen.
      void qc.invalidateQueries({ queryKey: agentKeys.list(wsId) });
      void qc.invalidateQueries({ queryKey: agentKeys.listAll(wsId) });
    },
  });
}

export function useSetAgentSkills(agentId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: SetAgentSkillsRequest) =>
      api.setAgentSkills(agentId, data),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: agentKeys.list(wsId) });
      void qc.invalidateQueries({ queryKey: agentKeys.listAll(wsId) });
    },
  });
}