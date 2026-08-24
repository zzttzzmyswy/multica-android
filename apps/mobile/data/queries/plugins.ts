import { queryOptions } from "@tanstack/react-query";
import type {
  PluginCatalogRelease,
  PluginInstallation,
} from "@multica/core/types";
import { api } from "@/data/api";
import { comparePluginVersions } from "@/lib/plugin-version";

// Plugin catalog + installation queries (iteration-99), mirroring
// packages/core/plugins/queries.ts bound to mobile's ApiClient. The pure
// helpers (state mapping / release grouping) extract the web plugins-tab.tsx
// useMemo logic into one shared source of truth so page and tests agree.
export const pluginKeys = {
  all: (wsId: string | null) => ["plugins", wsId] as const,
  catalog: (wsId: string | null) => [...pluginKeys.all(wsId), "catalog"] as const,
  installed: (wsId: string | null) =>
    [...pluginKeys.all(wsId), "installed"] as const,
};

export const pluginCatalogOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: pluginKeys.catalog(wsId),
    queryFn: () => api.listPluginCatalog(wsId ?? ""),
    enabled: !!wsId,
  });

export const pluginInstallationsOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: pluginKeys.installed(wsId),
    queryFn: () => api.listPluginInstallations(wsId ?? ""),
    enabled: !!wsId,
  });

export type PluginInstallationState =
  | "disabled"
  | "activating"
  | "healthy"
  | "degraded"
  | "failed";

/** Single source of truth for a Plugin installation's visible state —
 *  identical to web plugins-tab.tsx installationState(). */
export function pluginInstallationState(
  installation: PluginInstallation,
): PluginInstallationState {
  if (installation.enabled !== true) return "disabled";
  if (installation.lifecycle_status === "activating") return "activating";
  if (
    installation.health_state === "error" ||
    installation.lifecycle_status === "error"
  ) {
    return "failed";
  }
  if (
    installation.health_state === "degraded" ||
    installation.lifecycle_status === "degraded"
  ) {
    return "degraded";
  }
  return "healthy";
}

/** Group catalog releases by plugin_key, versions newest-first — mirrors web
 *  plugins-tab.tsx releasesByPlugin useMemo. */
export function groupCatalogReleases(
  releases: PluginCatalogRelease[],
): Map<string, PluginCatalogRelease[]> {
  const grouped = new Map<string, PluginCatalogRelease[]>();
  for (const release of releases) {
    const versions = grouped.get(release.plugin_key) ?? [];
    versions.push(release);
    grouped.set(release.plugin_key, versions);
  }
  for (const versions of grouped.values()) {
    versions.sort((left, right) =>
      comparePluginVersions(right.version, left.version),
    );
  }
  return grouped;
}