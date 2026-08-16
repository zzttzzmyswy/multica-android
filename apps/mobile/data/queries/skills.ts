/**
 * Workspace skills list + detail queries. Root key mirrors web's
 * workspaceKeys.skills (`["workspaces", wsId, "skills"]`) minus the shared
 * workspace prefix mobile doesn't use — the list/detail caches are separate
 * because the list endpoint deliberately omits `content`/`files` bodies
 * (they are 50–200KB each; GH multica-ai/multica#2174).
 */
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const skillKeys = {
  all: (wsId: string | null) => ["skills", wsId] as const,
  detail: (wsId: string | null, id: string) =>
    [...skillKeys.all(wsId), "detail", id] as const,
};

export const skillListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: skillKeys.all(wsId),
    queryFn: ({ signal }) => api.listSkills({ signal }),
    enabled: !!wsId,
  });

export const skillDetailOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: skillKeys.detail(wsId, id),
    queryFn: () => api.getSkill(id),
    enabled: !!wsId && !!id,
  });