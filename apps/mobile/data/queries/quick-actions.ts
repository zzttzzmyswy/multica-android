import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

// Workspace quick-action catalog (iteration-52) — mirrors
// packages/core/quick-actions/queries.ts, bound to mobile's ApiClient.
// The list endpoint already returns archived rows when asked; the page toggles
// `includeArchived` to decide whether to show them.
export const quickActionKeys = {
  all: (wsId: string | null) => ["quick-actions", wsId] as const,
  list: (wsId: string | null, includeArchived = false) =>
    [...quickActionKeys.all(wsId), "list", includeArchived] as const,
};

export const quickActionListOptions = (
  wsId: string | null,
  includeArchived = false,
) =>
  queryOptions({
    queryKey: quickActionKeys.list(wsId, includeArchived),
    queryFn: () => api.listQuickActions({ includeArchived }),
    select: (data) => data.quick_actions,
    enabled: !!wsId,
  });