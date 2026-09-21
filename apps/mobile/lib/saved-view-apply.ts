/**
 * Applying a saved issue view to a surface's view store.
 *
 * Three surfaces mount the saved-view bar — the workspace Issues page
 * (`more/issues.tsx`), My Issues (`(tabs)/my-issues.tsx`) and the project
 * issue surface (`project/project-issue-surface.tsx`). Each used to inline its
 * own copy of "reset the filter slice from the view's query, take the display
 * defaults, mark the view active". The copies were identical; the scope-tab
 * vocabulary is the only thing that differs.
 *
 * The scope axis a view captured is part of the VIEW, not of the visit (web
 * semantics): opening it lands on the captured tab, but that tab is a
 * side-effect of opening — exiting the view must leave the user where the view
 * put them, the same way web's `?view=` URL keeps its path after the view is
 * closed. So `exitView` restores the filter slice and clears the active id; it
 * deliberately does NOT touch `scope`.
 *
 * `useApplyExternallyActivatedView` is what makes the PINNED list work. A
 * pinned view row navigates to the surface that owns the view's scope and
 * marks the view active in `useActiveIssueViewStore`; the surface then has to
 * notice that the active view is not the one it renders and apply it.
 * Without it, tapping a pinned view lands on an unfiltered list whose view chip
 * reads as active.
 */
import { useEffect } from "react";
import type { IssueView } from "@multica/core/api/schemas";
import {
  sanitizeViewDisplay,
  sanitizeViewQuery,
} from "@/data/stores/issue-view-codec";
import { useActiveIssueViewStore } from "@/data/stores/active-issue-view-store";
import type { IssuesScope } from "@/data/stores/issues-view-store";
import type { MyIssuesScope } from "@/data/queries/issue-keys";
import type { IssueSortField } from "@/data/stores/issue-filter-slice";

/**
 * The slice of a view store `applySavedView` writes. Structural rather than a
 * union of the three store types: the stores are independent zustand instances
 * with identical shape, and a structural parameter keeps this module from
 * importing all three (and from having to grow when a fourth surface appears).
 */
export interface SavedViewTargetStore {
  setState: (partial: Record<string, unknown>) => void;
}

/** Saved-view `scope_variant` → workspace/project tab. Mirrors web
 *  `actorKindForViewVariant` (packages/core/issues/surface/scope.ts:41):
 *  unknown or absent means the unrestricted tab. */
export function actorKindForViewVariant(
  variant: string | null | undefined,
): IssuesScope {
  return variant === "members" || variant === "agents" ? variant : "all";
}

/** Saved-view `scope_variant` → my-scope tab. Mirrors web
 *  `myRelationForViewVariant` (scope.ts:48). The `involved` relation is the
 *  store's `agents` tab, matching the surface's own filter derivation. */
export function myScopeForViewVariant(
  variant: string | null | undefined,
): MyIssuesScope {
  switch (variant) {
    case "assigned":
      return "assigned";
    case "created":
      return "created";
    case "involved":
      return "agents";
    default:
      return "all";
  }
}

/**
 * Reset `store`'s filter slice to the view's snapshot + display defaults and
 * mark the view active for `containerKey`.
 *
 * `sortBy` is the surface's CURRENT sort: `sanitizeViewDisplay` needs a
 * fallback for a view whose display bag predates the sort-direction field.
 * `scope` is intentionally not written here — callers that want the view's
 * captured tab apply it themselves (see the module doc).
 */
export function applySavedView({
  view,
  store,
  containerKey,
  sortBy,
}: {
  view: IssueView;
  store: SavedViewTargetStore;
  containerKey: string;
  sortBy: IssueSortField;
}): void {
  const snapshot = sanitizeViewQuery(view.query);
  const display = sanitizeViewDisplay(view.display, sortBy);
  store.setState({
    ...snapshot,
    // Date is a user layer on top of a view (web semantics) — opening a view
    // clears whatever band was applied over the previous one.
    dateFilter: null,
    sortBy: display.sortBy,
    sortDirection: display.sortDirection,
    grouping: display.grouping,
    showSubIssues: display.showSubIssues,
    view: display.viewMode,
  });
  useActiveIssueViewStore.getState().setActive(containerKey, view.id);
}

/**
 * Apply a view that this surface did not open itself — a pinned view row, or
 * a scope switch that left an id behind.
 *
 * Fires only on an ID CHANGE. Re-applying every time the resolved view object
 * changes identity would fight the user's own edits: a view whose window has
 * drifted (`modifiedActive`) must stay drifted until they explicitly re-pick
 * it. The surface's own `applyView` records the id on `appliedViewIdRef` as
 * well, so its (identical) write is not immediately repeated here.
 */
export function useApplyExternallyActivatedView({
  activeViewId,
  activeView,
  appliedViewIdRef,
  onApply,
}: {
  activeViewId: string | null;
  /** The resolved view, or null while its list query is still in flight. */
  activeView: IssueView | null;
  appliedViewIdRef: { current: string | null };
  onApply: (view: IssueView) => void;
}): void {
  useEffect(() => {
    if (!activeView || activeView.id === appliedViewIdRef.current) return;
    appliedViewIdRef.current = activeView.id;
    onApply(activeView);
  }, [activeView, appliedViewIdRef, onApply]);
}
