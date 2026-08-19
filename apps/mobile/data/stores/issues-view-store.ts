/**
 * View store for the workspace-wide Issues page (`more/issues.tsx`).
 *
 * Shape mirrors `useMyIssuesViewStore` plus a `scope` field — workspace
 * Issues has `all / members / agents` scope tabs (see web
 * `packages/views/issues/components/issues-page.tsx:32-94`), while
 * My Issues has its own `assigned / created / agents` scopes.
 *
 * The `scope` filter is **client-side** on `assignee_type` — see
 * `more/issues.tsx`'s `scopedIssues` derivation. Server param stays unset
 * so the cache key (`issueKeys.list(wsId)`) and WS realtime invalidation
 * (`useIssuesRealtime`) don't have to know about scope.
 *
 * `IssuesScope` is defined locally rather than imported from
 * `@multica/core/issues/stores/issues-scope-store` — mobile only
 * `import type` from `@multica/core/types/*` per Sharing Principles, and
 * the union is small enough that a duplicated literal is preferable to a
 * cross-package type import hop.
 *
 * Empty filter array = "show all" (matches web's predicate semantics in
 * packages/views/issues/utils/filter.ts).
 *
 * No persist middleware — filters are session-scoped. `clearFilters`
 * deliberately does NOT reset `scope` so a workspace switch keeps the
 * user on the same scope tab (web's URL-driven scope reset is incidental
 * to its routing model, not an invariant mobile should mirror).
 *
 * Filter / sort / grouping fields beyond status+priority come from the
 * shared `issue-filter-slice.ts` — same field shape as web's
 * `packages/core/issues/stores/view-store.ts` FilterSnapshot so the same
 * filter input produces the same visible set on both clients.
 */
import { create } from "zustand";
import {
  createIssueFilterActions,
  defaultIssueFilterSlice,
  hasActiveIssueFilters,
  type ActorFilterValue,
  type IssueFilterSlice,
  type IssueGrouping,
  type IssueSortDirection,
  type IssueSortField,
  type IssueViewMode,
} from "./issue-filter-slice";
import {
  createTableColumnActions,
  defaultTableColumns,
  type TableColumnKey,
  type TableColumnsSlice,
} from "./issue-table-columns";

export type IssuesScope = "all" | "members" | "agents";

export interface IssuesViewState
  extends IssueFilterSlice,
    TableColumnsSlice {
  scope: IssuesScope;
  view: IssueViewMode;
  setScope: (scope: IssuesScope) => void;
  setView: (view: IssueViewMode) => void;
}

export const useIssuesViewStore = create<IssuesViewState>((set) => ({
  scope: "all",
  view: "list",
  tableColumns: defaultTableColumns(),
  ...defaultIssueFilterSlice(),
  setScope: (scope) => set({ scope }),
  setView: (view) => set({ view }),
  ...createIssueFilterActions<IssuesViewState>(set),
  ...createTableColumnActions<IssuesViewState>(set),
}));

/** Re-exported convenience: whether any filter dimension is active. */
export function useIssuesViewHasActiveFilters(): boolean {
  return hasActiveIssueFilters(useIssuesViewStore.getState());
}

export type {
  ActorFilterValue,
  IssueGrouping,
  IssueSortDirection,
  IssueSortField,
};
