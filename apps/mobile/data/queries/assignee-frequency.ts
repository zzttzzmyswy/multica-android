import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

/**
 * Per-actor assignment frequency for the signed-in user — how often they have
 * assigned work to each member / agent / squad. Mirrors web's
 * `assigneeFrequencyOptions` (packages/core/workspace/queries.ts:132).
 *
 * The endpoint is user-scoped rather than workspace-scoped: the server
 * aggregates from the caller's own assignee-change activities and issues they
 * created (`server/internal/handler/activity.go` `GetAssigneeFrequency`,
 * registered at `/api/assignee-frequency`). It takes no workspace path
 * segment; the workspace middleware still scopes the aggregation through the
 * `X-Workspace-Slug` header the api client sends.
 *
 * The key is namespaced under the workspace anyway, matching web's
 * `workspaceKeys.assigneeFrequency(wsId)`, so switching workspaces (a
 * different user's-own-history is not the issue — the same user in a
 * different workspace has different history) does not serve one workspace's
 * ranking inside another's picker.
 */
export const assigneeFrequencyOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: ["workspaces", wsId, "assignee-frequency"] as const,
    queryFn: ({ signal }) => api.getAssigneeFrequency({ signal }),
    enabled: !!wsId,
  });
