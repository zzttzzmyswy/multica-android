import type { IssueView } from "@multica/core/api/schemas";
import { issueViewContainerKey } from "@/data/stores/active-issue-view-store";
import type { IssueViewScope } from "@/data/queries/issue-views";

export interface DirectoryTarget {
  scope: IssueViewScope;
  /** Route to push, carrying `?view=` so the surface adopts it on load. */
  href: string;
  /** Active-view store key of that surface. */
  containerKey: string;
}

/**
 * The (scope_type, scope_id) container a saved view lives in.
 *
 * Extracted because two callers must agree on it: routing (where the row
 * opens) and writing (which cache list a delete or rename patches). A
 * disagreement would send the user to one surface while the optimistic patch
 * lands in another list, so the row would reappear on the page they are
 * looking at.
 *
 * Same degradations as `issueViewTarget` upstream: a project view missing its
 * `scope_id` collapses to workspace, and an unrecognised `scope_type` from a
 * newer backend does too.
 */
export function scopeOfView(
  view: Pick<IssueView, "scope_type" | "scope_id">,
): IssueViewScope {
  if (view.scope_type === "my") return { scope_type: "my" };
  if (view.scope_type === "project" && view.scope_id) {
    return { scope_type: "project", scope_id: view.scope_id };
  }
  return { scope_type: "workspace" };
}

/**
 * Where a directory row opens — web's `issueViewTarget`
 * (`packages/core/issue-views/view-target.ts`), translated to mobile's
 * route names.
 *
 * One resolved scope drives BOTH the href and the container key, which is
 * what keeps the two halves from disagreeing.
 *
 * Returns null when there is no slug or workspace to route within — the
 * caller has nothing to push, and inventing a path would be worse than
 * staying put.
 */
export function issueViewDirectoryTarget(
  wsId: string | null,
  wsSlug: string | null,
  view: Pick<IssueView, "id" | "scope_type" | "scope_id">,
): DirectoryTarget | null {
  if (!wsId || !wsSlug) return null;

  const scope = scopeOfView(view);

  const path =
    scope.scope_type === "my"
      ? `/${wsSlug}/my-issues`
      : scope.scope_type === "project"
        ? `/${wsSlug}/project/${scope.scope_id}`
        : `/${wsSlug}/more/issues`;

  return {
    scope,
    href: `${path}?view=${view.id}`,
    containerKey: issueViewContainerKey(wsId, scope),
  };
}

