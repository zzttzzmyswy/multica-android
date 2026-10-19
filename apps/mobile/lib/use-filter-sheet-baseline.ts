/**
 * The open saved view's baseline for a FILTER SHEET (iteration 258, MYS-2236).
 *
 * The issue surfaces already resolve this (`useFilterChipBaseline` in
 * `components/issue/issue-surface-chrome.tsx`), but the sheets are separate
 * routes: `issues-filter.tsx` and its two sub-sheets only receive a `scope`
 * param, so they had no way to know a view was open and reset unconditionally.
 * The result was that Reset inside a saved view wiped the view's own
 * definition instead of returning to it — while the chip bar on the list
 * behind the sheet did the right thing. Two paths, two answers.
 *
 * Rather than thread a query blob through three route params, this resolves
 * the same fact from the same stores the surfaces use: the container key is a
 * pure function of (workspace, scope), and the active-view id per container
 * already lives in `useActiveIssueViewStore`. So the sheet asks the store the
 * list already wrote to, and reads the same list query — one source, no new
 * plumbing, nothing that can drift.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  issueViewContainerKey,
  useActiveIssueViewStore,
} from "@/data/stores/active-issue-view-store";
import {
  issueViewListOptions,
  type IssueViewScope,
} from "@/data/queries/issue-views";
import {
  baselineFromViewQuery,
  type IssueViewBaseline,
} from "@/data/stores/issue-view-codec";
import type { IssueFilterScope } from "@/data/stores/issue-filter-store-registry";
import { useWorkspaceStore } from "@/data/workspace-store";

/**
 * The view container a filter-sheet scope reads. Mirrors what each surface
 * passes to `issueViewContainerKey` when it lists its views:
 *
 *   my      → `{ scope_type: "my" }`         (my-issues.tsx:238)
 *   all     → `{ scope_type: "workspace" }`  (more/issues.tsx:227)
 *   project → `{ scope_type: "project", scope_id }`
 *              (project-issue-surface.tsx:278)
 *
 * `projectId` is required for the project scope and ignored otherwise: a
 * project surface without an id has its own container (`scope_id: null`),
 * which is also what the surface itself would key on.
 */
export function filterSheetViewScope(
  scope: IssueFilterScope,
  projectId: string | null,
): IssueViewScope {
  switch (scope) {
    case "all":
      return { scope_type: "workspace" };
    case "project":
      return { scope_type: "project", scope_id: projectId };
    case "my":
      return { scope_type: "my" };
  }
}

export function useFilterSheetBaseline(
  scope: IssueFilterScope,
  projectId: string | null,
): IssueViewBaseline | null {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const viewScope = useMemo(
    () => filterSheetViewScope(scope, projectId),
    [scope, projectId],
  );
  const containerKey = useMemo(
    () => issueViewContainerKey(wsId, viewScope),
    [wsId, viewScope],
  );
  const activeViewId = useActiveIssueViewStore(
    (s) => s.active[containerKey] ?? null,
  );
  // The sheet is only open over a surface that already listed these views,
  // so this is a cache read in practice.
  const { data: views = [] } = useQuery(issueViewListOptions(wsId, viewScope));
  const activeView = useMemo(
    () => views.find((v) => v.id === activeViewId) ?? null,
    [views, activeViewId],
  );
  return useMemo(
    () => (activeView?.query ? baselineFromViewQuery(activeView.query) : null),
    [activeView],
  );
}
