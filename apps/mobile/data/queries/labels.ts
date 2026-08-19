/**
 * Workspace label queries.
 *
 * Two flavors:
 *   - `labelListOptions` — the workspace ISSUE label list (the legacy default;
 *     server defaults `resource_type=issue` when the param is absent). Used by
 *     the issue label pickers, the new-issue draft, and the Labels page.
 *   - `labelCatalogOptions(wsId, resourceType)` — a resource-scoped catalog
 *     (`?resource_type=skill`), used by the skill-detail labels picker so it
 *     only offers labels of that resource type (web resource-label-picker
 *     equivalence).
 *   - `resourceLabelsOptions(wsId, resourceType, resourceId)` — the labels
 *     currently ATTACHED to one agent/skill (`/api/{agents|skills}/{id}/labels`).
 *
 * Keys are workspace- and resource-scoped, so switching workspaces flips
 * wsId and TanStack Query picks up the new workspace's labels automatically.
 */
import { queryOptions } from "@tanstack/react-query";
import type { LabelResourceType } from "@multica/core/types";
import { api } from "@/data/api";

export const labelKeys = {
  all: (wsId: string | null) => ["labels", wsId] as const,
  // Resource-scoped catalog (e.g. skill labels) — separate from the issue-list
  // cache so the two never overwrite each other.
  catalog: (wsId: string | null, resourceType: LabelResourceType) =>
    [...labelKeys.all(wsId), "catalog", resourceType] as const,
  // Labels attached to one resource (agent/skill).
  byResource: (
    wsId: string | null,
    resourceType: LabelResourceType,
    resourceId: string,
  ) => [...labelKeys.all(wsId), "byResource", resourceType, resourceId] as const,
};

export const labelListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: labelKeys.all(wsId),
    queryFn: async ({ signal }) => {
      const res = await api.listLabels({ signal });
      return res.labels;
    },
    enabled: !!wsId,
  });

export const labelCatalogOptions = (
  wsId: string | null,
  resourceType: LabelResourceType,
) =>
  queryOptions({
    queryKey: labelKeys.catalog(wsId, resourceType),
    queryFn: async ({ signal }) => {
      const res = await api.listLabels({ signal, resourceType });
      return res.labels;
    },
    enabled: !!wsId,
  });

export const resourceLabelsOptions = (
  wsId: string | null,
  resourceType: LabelResourceType,
  resourceId: string,
) =>
  queryOptions({
    queryKey: labelKeys.byResource(wsId, resourceType, resourceId),
    queryFn: async ({ signal }) => {
      const res = await api.listLabelsForResource(resourceType, resourceId, {
        signal,
      });
      return res.labels;
    },
    enabled: !!wsId && !!resourceId,
  });