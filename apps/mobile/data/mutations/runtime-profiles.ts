/**
 * Custom runtime profile mutations (iteration-82, A2.3) — create / update /
 * delete of workspace runtime profiles. Mirrors packages/core/runtimes/profiles.ts
 * bound to mobile's ApiClient. Every mutation settles by invalidating the
 * profile list AND the runtime list — a rename / enable-flip can change how
 * the runtime browse labels bound instances, and a successful delete can
 * unregister its bound runtimes. Cache-first versions settle onSettled (like
 * the sibling runtimes mutations) because the forms read fresh data on open.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateRuntimeProfileRequest,
  UpdateRuntimeProfileRequest,
} from "@multica/core/types";
import { api } from "@/data/api";
import { runtimeProfileKeys } from "@/data/queries/runtime-profiles";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useWorkspaceStore } from "@/data/workspace-store";

function useWsId() {
  return useWorkspaceStore((s) => s.currentWorkspaceId);
}

export function useCreateRuntimeProfile() {
  const qc = useQueryClient();
  const wsId = useWsId();
  return useMutation({
    mutationFn: (body: CreateRuntimeProfileRequest) =>
      api.createRuntimeProfile(wsId ?? "", body),
    onSettled: () => invalidateProfileCaches(qc, wsId),
  });
}

export function useUpdateRuntimeProfile() {
  const qc = useQueryClient();
  const wsId = useWsId();
  return useMutation({
    mutationFn: ({
      profileId,
      patch,
    }: {
      profileId: string;
      patch: UpdateRuntimeProfileRequest;
    }) => api.updateRuntimeProfile(wsId ?? "", profileId, patch),
    onSettled: () => invalidateProfileCaches(qc, wsId),
  });
}

export function useDeleteRuntimeProfile() {
  const qc = useQueryClient();
  const wsId = useWsId();
  return useMutation({
    mutationFn: (profileId: string) =>
      api.deleteRuntimeProfile(wsId ?? "", profileId),
    onSettled: () => invalidateProfileCaches(qc, wsId),
  });
}

function invalidateProfileCaches(
  qc: ReturnType<typeof useQueryClient>,
  wsId: string | null,
) {
  if (!wsId) return;
  void qc.invalidateQueries({ queryKey: runtimeProfileKeys.all(wsId) });
  void qc.invalidateQueries({
    queryKey: runtimeListOptions(wsId).queryKey,
  });
}
// The 409 bounded-agents delete-refusal parser lives in lib/ (pure, no
// react-query), re-exported here so both the dialog and its unit tests can
// reach it through either surface.
export {
  parseRuntimeProfileBoundConflict,
  type RuntimeProfileBoundConflict,
} from "@/lib/runtime-profile-conflict";
