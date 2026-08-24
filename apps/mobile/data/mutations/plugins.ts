/**
 * Plugin mutations (iteration-99) — thin react-query wrappers over the
 * workspace Plugin lifecycle endpoints, mirroring packages/core/plugins/
 * mutations.ts. On settle both plugin queries (catalog + installations) are
 * invalidated so the Plugins page reflects the new state. Not optimistic —
 * the endpoints return the resulting PluginInstallation and the page shows
 * per-action loading state.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  PluginBindingRequest,
  PluginReleaseRequest,
} from "@multica/core/types";
import { api } from "@/data/api";
import { pluginKeys } from "@/data/queries/plugins";
import { useWorkspaceStore } from "@/data/workspace-store";

function useInvalidatePlugins(wsId: string | null) {
  const qc = useQueryClient();
  return () => {
    if (!wsId) return;
    void qc.invalidateQueries({ queryKey: pluginKeys.all(wsId) });
  };
}

export function useInstallPlugin() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidatePlugins(wsId);
  return useMutation({
    mutationFn: (request: PluginReleaseRequest) =>
      api.installPlugin(wsId ?? "", request),
    onSettled: invalidate,
  });
}

export function useUpgradePlugin() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidatePlugins(wsId);
  return useMutation({
    mutationFn: ({
      installationId,
      ...request
    }: PluginReleaseRequest & { installationId: string }) =>
      api.upgradePlugin(wsId ?? "", installationId, request),
    onSettled: invalidate,
  });
}

export function useSetPluginEnabled() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidatePlugins(wsId);
  return useMutation({
    mutationFn: ({
      installationId,
      enabled,
      binding,
    }: {
      installationId: string;
      enabled: boolean;
      binding: PluginBindingRequest;
    }) => api.setPluginEnabled(wsId ?? "", installationId, enabled, binding),
    onSettled: invalidate,
  });
}

export function useRollbackPlugin() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidatePlugins(wsId);
  return useMutation({
    mutationFn: ({ installationId, version }: { installationId: string; version: string }) =>
      api.rollbackPlugin(wsId ?? "", installationId, version),
    onSettled: invalidate,
  });
}

export function useUninstallPlugin() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidatePlugins(wsId);
  return useMutation({
    mutationFn: (installationId: string) =>
      api.uninstallPlugin(wsId ?? "", installationId),
    onSettled: invalidate,
  });
}