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
  return (updater: (old: Label[]) => Label[]) => {
    // labelListOptions stores a flat Label[] (unwrapped from the API
    // response envelope) at `labelKeys.all(wsId)` — patch that shape.
    qc.setQueryData<Label[]>(labelKeys.all(wsId), (old) =>
      old ? updater(old) : old,
    );
  };
}

export function useCreateLabel() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateLabels(wsId);
  const patchList = usePatchLabelList(wsId);

  return useMutation({
    mutationFn: (body: CreateLabelRequest) => api.createLabel(body),
    onSuccess: (label) => {
      // Append to the workspace label list cache so the picker sees the
      // new label without waiting for a refetch.
      patchList((old) =>
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
    mutationFn: ({ id, ...body }: { id: string } & UpdateLabelRequest) =>
      api.updateLabel(id, body),
    onSuccess: (label) => {
      // Replace in place with the authoritative server response so the
      // list (and the issue-detail picker) reflects the new name/color
      // without waiting for a refetch. Guard on a real id so a
      // drift-fallback EMPTY_LABEL can never wipe a row.
      if (!label.id) return;
      patchList((old) => old.map((l) => (l.id === label.id ? label : l)));
    },
    onSettled: invalidate,
  });
}

export function useDeleteLabel() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateLabels(wsId);
  const patchList = usePatchLabelList(wsId);

  return useMutation({
    mutationFn: (id: string) => api.deleteLabel(id),
    onSuccess: (_void, id) => {
      patchList((old) => old.filter((l) => l.id !== id));
    },
    onSettled: invalidate,
  });
}
