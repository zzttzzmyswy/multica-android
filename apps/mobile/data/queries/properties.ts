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
 *
 * Surfaces must read the catalog through `useActivePropertyCatalog` /
 * `usePropertyCatalog` rather than destructuring `data` with a `= []` default.
 * That default erases the difference between "still loading", "request
 * failed" and "this workspace has none", which is how a 30s timeout came to
 * render 「该工作区还没有自定义属性」 over a workspace that had `Severity`
 * (MYS-1892). The hooks expose the resolved four-state read instead.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { IssueProperty } from "@multica/core/types";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  isPropertyCatalogResolved,
  resolvePropertyCatalogState,
  type PropertyCatalogState,
} from "@/lib/property-catalog-state";

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

/** A catalog read with its load state intact. */
export interface PropertyCatalogRead {
  /** Definitions the projection returned. `[]` in every non-`ready` state —
   *  render the state, never this length, when the distinction matters. */
  definitions: IssueProperty[];
  state: PropertyCatalogState;
  /** The request settled, so `definitions` is the whole answer and an id
   *  missing from it is genuinely missing. */
  isResolved: boolean;
  /** Re-runs the request. Wire this to the retry affordance in `error`. */
  retry: () => void;
}

function usePropertyCatalogRead(
  wsId: string | null,
  includeArchived: boolean,
  enabled = true,
): PropertyCatalogRead {
  const options = includeArchived
    ? propertyCatalogOptions(wsId)
    : propertyActiveOptions(wsId);
  const query = useQuery({ ...options, enabled: enabled && !!wsId });

  const state = resolvePropertyCatalogState({
    definitions: query.data,
    isPending: query.isPending,
    isError: query.isError,
  });

  return {
    definitions: query.data ?? [],
    state,
    isResolved: isPropertyCatalogResolved(state),
    retry: query.refetch,
  };
}

/** Non-archived definitions plus the load state — the projection the filter
 *  panel, the board/table surfaces and the filter picker read. */
export function useActivePropertyCatalog(
  wsId?: string | null,
  options: { enabled?: boolean } = {},
): PropertyCatalogRead {
  const storeWsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return usePropertyCatalogRead(
    wsId ?? storeWsId,
    false,
    options.enabled ?? true,
  );
}

/** Include-archived definitions plus the load state — the projection the
 *  issue-detail chips, the value editor and the "+ add property" list read. */
export function usePropertyCatalog(
  wsId?: string | null,
): PropertyCatalogRead {
  const storeWsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return usePropertyCatalogRead(wsId ?? storeWsId, true);
}