import { queryOptions } from "@tanstack/react-query";
import type { ListVCSConnectionsResponse } from "@multica/core/types";
import { api } from "@/data/api";

// VCS integration queries (iteration-59) — self-hosted Git provider
// connections (Forgejo / Gitea / GitLab). Mirrors packages/core/vcs/queries.ts
// bound to mobile's ApiClient. The list drives the Settings → Integrations VCS
// section; its `available` / `configured` / `can_manage` flags gate visibility
// and the connect form, exactly like web's integrations-tab.
export const vcsKeys = {
  all: (wsId: string | null) => ["vcs", wsId] as const,
  connections: (wsId: string | null) =>
    [...vcsKeys.all(wsId), "connections"] as const,
};

export const vcsConnectionsOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: vcsKeys.connections(wsId),
    queryFn: () => api.listVCSConnections(wsId ?? ""),
    enabled: !!wsId,
  });

/** Deployment/visibility semantics for the VCS section, extracted from the
 *  parsed list response so both the section component and its unit tests share
 *  one source of truth. Mirrors web's vcs-tab.tsx client contract
 *  (packages/core/types/vcs.ts): `available` false hides the whole section,
 *  `configured` true enables the connect form, `can_manage` true allows
 *  connect/disconnect. Older backends omit the flags, so each defaults to the
 *  safe client-side value (available → render, configured → disabled,
 *  can_manage → read-only) rather than crashing the page. */
export interface VCSViewState {
  /** false → the deployment cannot offer the integration; hide the section. */
  available: boolean;
  /** true → the deployment has MULTICA_VCS_SECRET_KEY; enable the form. */
  configured: boolean;
  /** true → the caller is an owner/admin; show manage actions + form. */
  canManage: boolean;
}

export function vcsViewState(
  data: ListVCSConnectionsResponse | undefined,
): VCSViewState {
  return {
    available: data?.available !== false,
    configured: data?.configured === true,
    canManage: data?.can_manage === true,
  };
}