/**
 * Mobile-side label mutations. Mirrors the design of
 * `packages/core/labels/mutations.ts` but binds to mobile's own ApiClient
 * (`@/data/api`) and workspace store — the core hook depends on
 * `useWorkspaceId` from `packages/core/hooks` which mobile does not share.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateLabelRequest,
  Label,
  LabelResourceType,
  UpdateLabelRequest,
} from "@multica/core/types";
import { api } from "@/data/api";
import { labelKeys } from "@/data/queries/labels";
import { useWorkspaceStore } from "@/data/workspace-store";

function useInvalidateLabels(wsId: string | null) {
  const qc = useQueryClient();
  return () => {
    if (!wsId) return;
    void qc.invalidateQueries({ queryKey: labelKeys.all(wsId) });
  };
}

function usePatchLabelList(wsId: string | null) {
  const qc = useQueryClient();
  return (
    resourceType: LabelResourceType | undefined,
    updater: (old: Label[]) => Label[],
  ) => {
    // Issue labels live in the legacy unscoped cache — the same flat Label[]
    // the issue pickers and the new-issue draft read. Skill labels have their
    // own catalog key. Patching the wrong one would inject a skill label into
    // the issue picker (and vice versa), so route by the label's own scope.
    const key =
      resourceType === "skill"
        ? labelKeys.catalog(wsId, "skill")
        : labelKeys.all(wsId);
    qc.setQueryData<Label[]>(key, (old) => (old ? updater(old) : old));
  };
}

export function useCreateLabel() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateLabels(wsId);
  const patchList = usePatchLabelList(wsId);

  return useMutation({
    mutationFn: (body: CreateLabelRequest) => api.createLabel(body),
    onSuccess: (label) => {
      // Append to that scope's cache so the list (and the matching picker)
      // sees the new label without waiting for a refetch.
      patchList(label.resource_type, (old) =>
        old.some((l) => l.id === label.id) ? old : [...old, label],
      );
    },
    onSettled: invalidate,
  });
}

export function useUpdateLabel() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateLabels(wsId);
  const patchList = usePatchLabelList(wsId);

  return useMutation({
    // `resource_type` scopes the cache patch only — the server rejects it as
    // an update field (mirrors core's useUpdateLabel destructure).
    mutationFn: ({
      id,
      resource_type: _resourceType,
      ...body
    }: { id: string; resource_type?: LabelResourceType } & UpdateLabelRequest) =>
      api.updateLabel(id, body),
    onSuccess: (label, variables) => {
      // Replace in place with the authoritative server response so the
      // list (and the issue-detail picker) reflects the new name/color
      // without waiting for a refetch. Guard on a real id so a
      // drift-fallback EMPTY_LABEL can never wipe a row.
      if (!label.id) return;
      const scope = label.resource_type ?? variables.resource_type;
      patchList(scope, (old) => old.map((l) => (l.id === label.id ? label : l)));
    },
    onSettled: invalidate,
  });
}

export function useDeleteLabel() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateLabels(wsId);
  const patchList = usePatchLabelList(wsId);

  return useMutation({
    // Accepts the bare id (issue scope, the legacy call shape) or an explicit
    // `{ id, resource_type }` so a skill label is dropped from its own cache.
    mutationFn: (input: string | { id: string; resource_type: LabelResourceType }) =>
      api.deleteLabel(typeof input === "string" ? input : input.id),
    onSuccess: (_void, input) => {
      const id = typeof input === "string" ? input : input.id;
      const scope = typeof input === "string" ? undefined : input.resource_type;
      patchList(scope, (old) => old.filter((l) => l.id !== id));
    },
    onSettled: invalidate,
  });
}

// --- Resource (agent/skill) label attach/detach ---

/** Optimistically toggles one label in the resource's attached-label cache. */
function usePatchResourceLabels(
  wsId: string | null,
  resourceType: LabelResourceType,
  resourceId: string,
) {
  const qc = useQueryClient();
  const key = labelKeys.byResource(wsId, resourceType, resourceId);
  return (updater: (old: Label[]) => Label[]) => {
    qc.setQueryData<Label[]>(key, (old) => (old ? updater(old) : old));
  };
}

export function useAttachResourceLabel(
  resourceType: LabelResourceType,
  resourceId: string,
) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const qc = useQueryClient();
  const patch = usePatchResourceLabels(wsId, resourceType, resourceId);

  return useMutation({
    mutationFn: (labelId: string) =>
      api.attachLabelToResource(resourceType, resourceId, labelId),
    // The server returns the post-mutation label list — replace the cache
    // with the authoritative payload instead of guessing.
    onSuccess: (res) => {
      patch(() => {
        const labels = res.labels ?? [];
        return labels;
      });
    },
    onSettled: () => {
      if (wsId) {
        void qc.invalidateQueries({
          queryKey: labelKeys.byResource(wsId, resourceType, resourceId),
        });
      }
    },
  });
}

export function useDetachResourceLabel(
  resourceType: LabelResourceType,
  resourceId: string,
) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const qc = useQueryClient();
  const patch = usePatchResourceLabels(wsId, resourceType, resourceId);

  return useMutation({
    mutationFn: (labelId: string) =>
      api.detachLabelFromResource(resourceType, resourceId, labelId),
    onSuccess: (res) => {
      patch(() => res.labels ?? []);
    },
    onSettled: () => {
      if (wsId) {
        void qc.invalidateQueries({
          queryKey: labelKeys.byResource(wsId, resourceType, resourceId),
        });
      }
    },
  });
}
