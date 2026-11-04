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
  everywhere: (wsId: string | null) =>
    [...issueViewKeys.all(wsId), "everywhere"] as const,
};

/**
 * Every view the caller can open, across workspace, my and project scopes —
 * web's `issueViewEverywhereOptions` (`packages/core/issue-views/queries.ts`).
 *
 * Backs the "All views" directory. Before this existed the mobile client had
 * no cross-scope read at all: each surface could only list the one scope it
 * was mounted on, so a view hidden from its bar, or one shared from another
 * scope, was unreachable from the phone.
 *
 * The fallback is for servers predating the `scope_type=all` branch
 * (`server/internal/handler/issue_view.go:263`): they answer 400, and the two
 * scopes they DO expose give the same rows minus project-scoped ones. The
 * fallback deliberately does NOT catch every error — a network failure
 * answered with a shorter list would render "you have fewer views than you
 * do" as fact, which is the same assertion-of-absence defect this codebase
 * has already fixed twice (`catalogRead` / `recordRead`). So the fallback
 * rethrows whenever it cannot produce a list either.
 */
export function issueViewEverywhereOptions(wsId: string | null) {
  return queryOptions({
    queryKey: issueViewKeys.everywhere(wsId),
    queryFn: async (): Promise<IssueView[]> => {
      try {
        return await api.listIssueViews({ scope_type: "all" });
      } catch {
        const [workspace, my] = await Promise.all([
          api.listIssueViews({ scope_type: "workspace" }),
          api.listIssueViews({ scope_type: "my" }),
        ]);
        return [...workspace, ...my];
      }
    },
    enabled: !!wsId,
  });
}

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

/**
 * Whether a surface's saved-view dialog offers the visibility toggle
 * (private ⇄ workspace) for a given scope type. Mirrors web
 * save-view-dialog.tsx:718-726 — the visibility row renders for every
 * scope.kind != my (workspace AND project); my-scope views are always
 * private (server constrains them).
 */
export function scopeAllowsViewVisibility(
  scope_type: IssueViewScope["scope_type"],
): boolean {
  return scope_type !== "my";
}

/** The visibility value the dialog actually submits — a my-scope surface
 *  that somehow passes "workspace" is forced back to private (defence-in-
 *  depth behind the toggle's absence). */
export function resolveSubmittedVisibility(
  visibilityAllowed: boolean,
  visibility: "private" | "workspace",
): "private" | "workspace" {
  return visibilityAllowed ? visibility : "private";
}