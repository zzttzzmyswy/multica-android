/**
 * Custom runtime profile queries (iteration-82, A2.3) — workspace-scoped
 * profile CRUD. Mirrors packages/core/runtimes/profiles.ts bound to mobile's
 * ApiClient. Keys stay separate from `runtimeKeys` (registered instances)
 * because the two resources invalidate on different events — but profile
 * writes also invalidate the instance list below, via the mutation files.
 */
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const runtimeProfileKeys = {
  all: (wsId: string | null) => ["runtime-profiles", wsId] as const,
  list: (wsId: string | null) =>
    [...runtimeProfileKeys.all(wsId), "list"] as const,
};

export const runtimeProfileListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: runtimeProfileKeys.list(wsId),
    queryFn: () => api.listRuntimeProfiles(wsId ?? ""),
    enabled: !!wsId,
  });