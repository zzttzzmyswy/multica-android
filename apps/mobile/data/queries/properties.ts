/**
 * Workspace custom-property catalog queries (MYS-334). Two projections:
 *
 *   - `propertyActiveOptions` — non-archived definitions only, used by the
 *     issue-detail "+ add property" surface.
 *   - `propertyCatalogOptions` — includes archived definitions, because an
 *     issue can still carry a value for an archived property and the build
 *     prompt must be able to resolve its option ids / labels.
 *
 * Workspace-scoped keys — switching workspaces flips wsId and the cache
 * follows (root CLAUDE.md "Workspace-scoped queries must key on wsId").
 */
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const propertyKeys = {
  all: (wsId: string | null) => ["properties", wsId] as const,
  list: (wsId: string | null, includeArchived: boolean) =>
    [...propertyKeys.all(wsId), includeArchived] as const,
};

export const propertyActiveOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: propertyKeys.list(wsId, false),
    queryFn: async ({ signal }) => {
      const res = await api.listProperties({ includeArchived: false, signal });
      return res.properties;
    },
    enabled: !!wsId,
  });

export const propertyCatalogOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: propertyKeys.list(wsId, true),
    queryFn: async ({ signal }) => {
      const res = await api.listProperties({ includeArchived: true, signal });
      return res.properties;
    },
    enabled: !!wsId,
  });