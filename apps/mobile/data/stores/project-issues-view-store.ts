/**
 * View store for the project-scoped issue surface (iteration-68) — the
 * project detail page's full issue workbench (`ProjectIssueSurface`).
 *
 * Follows the same pattern as `issues-view-store.ts` (workspace-wide
 * Issues page) and `my-issues-view-store.ts` (My Issues): a scope tab +
 * view mode + the shared filter/sort/grouping slice, all in-memory
 * (session-scoped, no persist middleware).
 *
 * The `scope` tab (all / members / agents) is a **client-side** filter on
 * `assignee_type`, mirroring web's project-page tabs — web remembers each
 * project's tab under `issues-scope-store` keyed `project:<id>`; mobile
 * keeps a single store because only one project page is open at a time.
 * The semantics are identical either way. Filter/sort/grouping behavior is
 * the same "same N rule" as the other two stores: the shared slice mirrors
 * web's view-store field shape, so the same filter input produces the same
 * visible set on both clients.
 *
 * The saved-view container for this surface is fixed at
 * `{ scope_type: "project", scope_id }` — that identity lives in the
 * surface component (and `IssueViewBar`'s `scope` prop), NOT in this
 * store, so there is nothing project-id-shaped to persist here.
 */
import { create } from "zustand";
import type { SwimlaneGrouping } from "@/lib/swimlane";
import {
  createIssueFilterActions,
  defaultIssueFilterSlice,
  hasActiveIssueFilters,
  type IssueFilterSlice,
  type IssueViewMode,
} from "./issue-filter-slice";
import {
  createTableColumnActions,
  defaultTableColumns,
  defaultTableColumnWidths,
  type TableColumnKey,
  type TableColumnsSlice,
} from "./issue-table-columns";
import {
  createTableGroupingActions,
  defaultTableGrouping,
  type TableGroupingSlice,
} from "./issue-table-grouping";
import type { IssuesScope } from "./issues-view-store";

export interface ProjectIssuesViewState
  extends IssueFilterSlice,
    TableColumnsSlice,
    TableGroupingSlice {
  /** Scope tab — all / members / agents, mirroring web's project-page
   *  issue tabs (`issues-scope-store` keyed `project:<id>`). */
  scope: IssuesScope;
  view: IssueViewMode;
  /** Active swimlane grouping dimension — only read in swimlane mode.
   *  Default `assignee`, matching web `view-store.ts` defaults. */
  swimlaneGrouping: SwimlaneGrouping;
  setScope: (scope: IssuesScope) => void;
  setView: (view: IssueViewMode) => void;
  setSwimlaneGrouping: (grouping: SwimlaneGrouping) => void;
}

export const useProjectIssuesViewStore = create<ProjectIssuesViewState>(
  (set) => ({
    scope: "all",
    view: "list",
    swimlaneGrouping: "assignee",
    tableColumns: defaultTableColumns(),
    tableColumnWidths: defaultTableColumnWidths(),
    tableGrouping: defaultTableGrouping(),
    ...defaultIssueFilterSlice(),
    setScope: (scope) => set({ scope }),
    setView: (view) => set({ view }),
    setSwimlaneGrouping: (swimlaneGrouping) => set({ swimlaneGrouping }),
    ...createIssueFilterActions<ProjectIssuesViewState>(set),
    ...createTableColumnActions<ProjectIssuesViewState>(set),
    ...createTableGroupingActions<ProjectIssuesViewState>(set),
  }),
);

/** Convenience selector: whether any filter dimension is active. */
export function useProjectIssuesViewHasActiveFilters(): boolean {
  return hasActiveIssueFilters(useProjectIssuesViewStore.getState());
}