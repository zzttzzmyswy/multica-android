/**
 * Custom-property mutations (MYS-334). Mirrors web's
 * packages/core/properties/mutations.ts but binds to mobile's own ApiClient
 * and workspace store.
 *
 * Definition CRUD invalidates the catalog. Value writes (set/unset) also
 * patch the issue's `properties` bag into every cached copy of that issue
 * (detail + workspace list + all my-issue list keys) so the issue-detail
 * chips refresh without a refetch, then invalidate the catalog for usage
 * counts.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreatePropertyRequest,
  IssuePropertyValues,
  UpdatePropertyRequest,
} from "@multica/core/types";
import { api } from "@/data/api";
import { propertyKeys } from "@/data/queries/properties";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  patchIssueDetail,
  patchIssuesList,
  patchMyIssuesList,
} from "@/data/realtime/issue-ws-updaters";

function useInvalidateProperties(wsId: string | null) {
  const qc = useQueryClient();
  return () => {
    if (!wsId) return;
    void qc.invalidateQueries({ queryKey: propertyKeys.all(wsId) });
  };
}

function usePatchPropertyList(wsId: string | null) {
  const qc = useQueryClient();
  return (updater: (old: import("@multica/core/types").IssueProperty[]) => import("@multica/core/types").IssueProperty[]) => {
    qc.setQueryData(propertyKeys.list(wsId, true), (old) => {
      const current = Array.isArray(old)
        ? (old as import("@multica/core/types").IssueProperty[])
        : [];
      return updater(current);
    });
  };
}

export function useCreateProperty() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateProperties(wsId);
  const patchList = usePatchPropertyList(wsId);

  return useMutation({
    mutationFn: (body: CreatePropertyRequest) => api.createProperty(body),
    onSuccess: (property) => {
      if (!property.id) return;
      patchList((old) =>
        old.some((p) => p.id === property.id)
          ? old.map((p) => (p.id === property.id ? property : p))
          : [...old, property],
      );
    },
    onSettled: invalidate,
  });
}

export function useUpdateProperty() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateProperties(wsId);
  const patchList = usePatchPropertyList(wsId);

  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & UpdatePropertyRequest) =>
      api.updateProperty(id, body),
    onSuccess: (property) => {
      if (!property.id) return;
      patchList((old) => old.map((p) => (p.id === property.id ? property : p)));
    },
    onSettled: invalidate,
  });
}

/** Write the full post-mutation value bag into every cached copy of the issue. */
function patchIssuePropertyBag(
  qc: ReturnType<typeof useQueryClient>,
  wsId: string | null,
  issueId: string,
  properties: IssuePropertyValues,
) {
  if (!wsId) return;
  const patch = { id: issueId, properties };
  patchIssueDetail(qc, wsId, patch);
  patchIssuesList(qc, wsId, patch);
  patchMyIssuesList(qc, wsId, patch);
}

export function useSetIssueProperty() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateProperties(wsId);

  return useMutation({
    mutationFn: ({
      issueId,
      propertyId,
      value,
    }: {
      issueId: string;
      propertyId: string;
      value: import("@multica/core/types").IssuePropertyValue;
    }) => api.setIssueProperty(issueId, propertyId, value),
    scope: { id: "issue-properties" },
    mutationKey: ["issue-properties", wsId],
    onSuccess: (data, { issueId }) => {
      patchIssuePropertyBag(qc, wsId, issueId, data.properties ?? {});
      invalidate();
    },
  });
}

export function useUnsetIssueProperty() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateProperties(wsId);

  return useMutation({
    mutationFn: ({ issueId, propertyId }: { issueId: string; propertyId: string }) =>
      api.unsetIssueProperty(issueId, propertyId),
    scope: { id: "issue-properties" },
    mutationKey: ["issue-properties", wsId],
    onSuccess: (data, { issueId }) => {
      patchIssuePropertyBag(qc, wsId, issueId, data.properties ?? {});
      invalidate();
    },
  });
}