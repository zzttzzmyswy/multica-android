/**
 * Saved-issue-view query layer (iteration-65). Keys mirror web's
 * `packages/core/issue-views/queries.ts`:
 *   issue-views / <wsId> / <scope_type> / <scope_id|null>   (scope list)
 *   issue-views / <wsId> / detail / <viewId>                (one view)
 * Same prefix shape as web so a future shared WS invalidation surface can
 * reach both clients.
 *
 * `canManageIssueView` is the client-side mirror of `server/internal/
 * handler/issue_view.go` `canManageIssueView`: the owner, or a workspace
 * owner/admin for views shared to the workspace. It only gates affordances —
 * the server re-checks on every write.
 */
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";
import type { IssueView } from "@multica/core/api/schemas";

/** The (scope_type, scope_id) container a surface's views live in. */
export interface IssueViewScope {
  scope_type: "workspace" | "my" | "project";
  scope_id?: string | null;
}

export const issueViewKeys = {
  all: (wsId: string | null) => ["issue-views", wsId] as const,
  list: (wsId: string | null, scope: IssueViewScope) =>
    [
      ...issueViewKeys.all(wsId),
      scope.scope_type,
      scope.scope_id ?? null,
    ] as const,
  detail: (wsId: string | null, id: string) =>
    [...issueViewKeys.all(wsId), "detail", id] as const,
};

export function issueViewListOptions(
  wsId: string | null,
  scope: IssueViewScope,
) {
  return queryOptions({
    queryKey: issueViewKeys.list(wsId, scope),
    queryFn: () => api.listIssueViews({ scope_type: scope.scope_type, scope_id: scope.scope_id }),
    enabled: !!wsId,
  });
}

/** One view by id — used by surfaces that hold a direct reference. */
export function issueViewDetailOptions(wsId: string | null, id: string) {
  return queryOptions({
    queryKey: issueViewKeys.detail(wsId, id),
    queryFn: () => api.getIssueView(id),
    enabled: !!wsId && !!id,
  });
}

/**
 * Client-side mirror of the server's canManageIssueView: the owner, or a
 * workspace owner/admin for views shared to the workspace. Drives which
 * affordances render — the server re-checks on every write (issue_view.go).
 */
export function canManageIssueView(
  view: Pick<IssueView, "owner_id" | "visibility">,
  userId: string | null | undefined,
  role: string | null | undefined,
): boolean {
  if (!userId) return false;
  if (view.owner_id === userId) return true;
  return view.visibility === "workspace" && (role === "owner" || role === "admin");
}