import { useQuery } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

// Server-config / feature-flag queries (iteration-99). Web reads the app
// config once at boot into `@multica/core/config` (zustand) and gates optional
// surfaces behind `feature_flags` via `useFeatureEnabled(PLUGINS_V1_FLAG)`.
// Mobile previously never consumed /api/config, so every flag-gated feature
// (Plugins, Composio, …) was invisible regardless of what the deployment
// enabled. This module supplies the same lookup against a react-query cache,
// keyed globally (config is workspace-independent).
export const configKeys = {
  all: () => ["server-config"] as const,
};

export const serverConfigOptions = () =>
  queryOptions({
    queryKey: configKeys.all(),
    queryFn: () => api.getConfig(),
    // Config rarely changes and is cheap; a short stale window absorbs a
    // burst of gate checks (e.g. several settings rows reading the same flag)
    // into one in-flight request.
    staleTime: 5 * 60 * 1000,
  });

/** Pure flag lookup matching web's `featureFlagEnabled` in
 *  packages/core/config/index.ts. Absent/unknown flags resolve to the
 *  caller's default so an older server never fails open. */
export function featureFlagEnabled(
  flags: Readonly<Record<string, boolean>> | undefined,
  key: string,
  defaultValue = false,
): boolean {
  return flags?.[key] ?? defaultValue;
}

/** Hook form for UI gates — same contract as web's
 *  `useFeatureEnabled(key, defaultValue)`. A failed or pending config fetch
 *  resolves to the default, so a gate never renders optimistically. */
export function useFeatureEnabled(key: string, defaultValue = false): boolean {
  const { data } = useQuery(serverConfigOptions());
  return featureFlagEnabled(data?.feature_flags, key, defaultValue);
}