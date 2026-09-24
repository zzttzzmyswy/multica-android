/**
 * Per-agent channel-binding mutations (iteration 170) — the write half of the
 * agent Integrations screen.
 *
 * Each successful write invalidates that channel's `["<channel>", wsId]`
 * namespace, the same key the workspace-level Integrations page and the agent
 * page both read, so the list refetch is the single source of truth and the
 * two surfaces never disagree (web invalidates the identical key —
 * lark-tab.tsx:757, slack-tab.tsx:337).
 *
 * The Lark device flow has no mutation of its own: `begin` and the status
 * poll are a one-shot session owned by the dialog, not cache state, so the
 * dialog calls `api` directly and only its success path invalidates.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  RegisterDingTalkBYORequest,
  RegisterSlackBYORequest,
  RegisterWecomBYORequest,
} from "@multica/core/types";
import { api } from "@/data/api";
import {
  dingtalkKeys,
  larkKeys,
  slackKeys,
  wecomKeys,
} from "@/data/queries/integrations";
import { useWorkspaceStore } from "@/data/workspace-store";

export function useDisconnectLarkInstallation() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: (installationId: string) =>
      api.deleteLarkInstallation(wsId ?? "", installationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: larkKeys.all(wsId) }),
  });
}

export function useRegisterSlackBYO() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: (vars: { agentId: string; body: RegisterSlackBYORequest }) =>
      api.registerSlackBYO(wsId ?? "", vars.agentId, vars.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: slackKeys.all(wsId) }),
  });
}

export function useDisconnectSlackInstallation() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: (installationId: string) =>
      api.deleteSlackInstallation(wsId ?? "", installationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: slackKeys.all(wsId) }),
  });
}

export function useRegisterDingTalkBYO() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: (vars: { agentId: string; body: RegisterDingTalkBYORequest }) =>
      api.registerDingTalkBYO(wsId ?? "", vars.agentId, vars.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: dingtalkKeys.all(wsId) }),
  });
}

export function useDisconnectDingTalkInstallation() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: (installationId: string) =>
      api.deleteDingTalkInstallation(wsId ?? "", installationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: dingtalkKeys.all(wsId) }),
  });
}

export function useRegisterWecomBYO() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: (vars: { agentId: string; body: RegisterWecomBYORequest }) =>
      api.registerWecomBYO(wsId ?? "", vars.agentId, vars.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: wecomKeys.all(wsId) }),
  });
}

export function useDisconnectWecomInstallation() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: (installationId: string) =>
      api.deleteWecomInstallation(wsId ?? "", installationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: wecomKeys.all(wsId) }),
  });
}
