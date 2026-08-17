/**
 * Shared filter/sort/grouping state slice for the two issue-list view
 * stores (`issues-view-store.ts` workspace-wide, `my-issues-view-store.ts`
 * My Issues). Mirrors the field shape of web's
 * `packages/core/issues/stores/view-store.ts` FilterSnapshot + sort +
 * grouping slice so the same filter input produces the same visible issue
 * set on both clients (the "same N rule" in apps/mobile/CLAUDE.md).
 *
 * Mobile cannot import core's runtime, so the type shapes below are
 * re-implemented locally. `ActorFilterValue` matches web's
 * `ActorFilterValue` (member / agent / squad), `IssueSortField` matches the
 * static `SortField` union, `IssueGrouping` matches `StaticIssueGrouping`.
 *
 * Empty filter array = "show all" (matches web's predicate semantics in
 * packages/views/issues/utils/filter.ts). The client predicate lives in
 * `lib/filter-issues.ts`; this slice only holds state.
 */
import type { StateCreator } from "zustand";
import type { IssuePriority, IssueStatus } from "@multica/core/types";
import type { IssueListWindowParams } from "@/data/queries/issue-keys";

export type ActorFilterValue = {
  type: "member" | "agent" | "squad";
  id: string;
};

/** Static sort keys, mirroring web `SORT_OPTIONS` (property sorts excluded
 *  — mobile has no custom-property sort this iteration). */
export type IssueSortField =
  | "position"
  | "status"
  | "priority"
  | "start_date"
  | "due_date"
  | "created_at"
  | "updated_at"
  | "title";

export type IssueSortDirection = "asc" | "desc";

/** Grouping mirroring web `GROUPING_OPTIONS` (status / assignee). */
export type IssueGrouping = "status" | "assignee";

export const ISSUE_SORT_OPTIONS: { value: IssueSortField; labelKey: string }[] =
  [
    { value: "position", labelKey: "filter.sort.position" },
    { value: "status", labelKey: "filter.sort.status" },
    { value: "priority", labelKey: "filter.sort.priority" },
    { value: "start_date", labelKey: "filter.sort.startDate" },
    { value: "due_date", labelKey: "filter.sort.dueDate" },
    { value: "created_at", labelKey: "filter.sort.createdAt" },
    { value: "updated_at", labelKey: "filter.sort.updatedAt" },
    { value: "title", labelKey: "filter.sort.titleField" },
  ];

export const ISSUE_GROUPING_OPTIONS: {
  value: IssueGrouping;
  labelKey: string;
}[] = [
  { value: "status", labelKey: "filter.group.status" },
  { value: "assignee", labelKey: "filter.group.assignee" },
];

export interface IssueFilterSlice {
  statusFilters: IssueStatus[];
  priorityFilters: IssuePriority[];
  assigneeFilters: ActorFilterValue[];
  includeNoAssignee: boolean;
  creatorFilters: ActorFilterValue[];
  projectFilters: string[];
  includeNoProject: boolean;
  labelFilters: string[];
  sortBy: IssueSortField;
  sortDirection: IssueSortDirection;
  grouping: IssueGrouping;
  toggleStatusFilter: (status: IssueStatus) => void;
  togglePriorityFilter: (priority: IssuePriority) => void;
  toggleAssigneeFilter: (value: ActorFilterValue) => void;
  toggleNoAssignee: () => void;
  toggleCreatorFilter: (value: ActorFilterValue) => void;
  toggleProjectFilter: (projectId: string) => void;
  toggleNoProject: () => void;
  toggleLabelFilter: (labelId: string) => void;
  setSortBy: (field: IssueSortField) => void;
  setSortDirection: (dir: IssueSortDirection) => void;
  setGrouping: (grouping: IssueGrouping) => void;
  clearFilters: () => void;
  /** Clear one filter dimension (a filter-bar chip). Paired boolean flags
   *  (no-assignee / no-project) clear with their dimension — matches web's
   *  `clearFilterDimension`. */
  clearFilterDimension: (dimension: FilterDimension) => void;
}

export type FilterDimension =
  | "status"
  | "priority"
  | "assignee"
  | "creator"
  | "project"
  | "label";

/** Default slice state — all filters empty, manual position sort asc,
 *  status grouping. Web's defaults are `sortBy: "position"` +
 *  `sortDirection: "asc"` + `grouping: "status"` (view-store.ts:272-286). */
export const defaultIssueFilterSlice = (): Pick<
  IssueFilterSlice,
  | "statusFilters"
  | "priorityFilters"
  | "assigneeFilters"
  | "includeNoAssignee"
  | "creatorFilters"
  | "projectFilters"
  | "includeNoProject"
  | "labelFilters"
  | "sortBy"
  | "sortDirection"
  | "grouping"
> => ({
  statusFilters: [],
  priorityFilters: [],
  assigneeFilters: [],
  includeNoAssignee: false,
  creatorFilters: [],
  projectFilters: [],
  includeNoProject: false,
  labelFilters: [],
  sortBy: "position",
  sortDirection: "asc",
  grouping: "status",
});

/**
 * Action factory shared by both issue-list view stores. `set` is the
 * zustand `setState` from the caller — generic over the store state T so
 * it works for both `IssuesViewState` and `MyIssuesViewState` (each of
 * which extends `IssueFilterSlice` with extra scope fields). Actions only
 * ever touch the slice fields, so a `Partial<T>` update is always safe.
 */
export function createIssueFilterActions<T extends IssueFilterSlice>(
  set: (
    partial:
      | Partial<IssueFilterSlice>
      | ((state: IssueFilterSlice) => Partial<IssueFilterSlice>),
  ) => void,
): Pick<
  IssueFilterSlice,
  | "toggleStatusFilter"
  | "togglePriorityFilter"
  | "toggleAssigneeFilter"
  | "toggleNoAssignee"
  | "toggleCreatorFilter"
  | "toggleProjectFilter"
  | "toggleNoProject"
  | "toggleLabelFilter"
  | "setSortBy"
  | "setSortDirection"
  | "setGrouping"
  | "clearFilters"
  | "clearFilterDimension"
> {
  const toggleInList = <T,>(list: T[], item: T): T[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  return {
    toggleStatusFilter: (status) =>
      set((state) => ({
        statusFilters: toggleInList(state.statusFilters, status),
      })),
    togglePriorityFilter: (priority) =>
      set((state) => ({
        priorityFilters: toggleInList(state.priorityFilters, priority),
      })),
    toggleAssigneeFilter: (value) =>
      set((state) => {
        const exists = state.assigneeFilters.some(
          (f) => f.type === value.type && f.id === value.id,
        );
        return {
          assigneeFilters: exists
            ? state.assigneeFilters.filter(
                (f) => !(f.type === value.type && f.id === value.id),
              )
            : [...state.assigneeFilters, value],
        };
      }),
    toggleNoAssignee: () =>
      set((state) => ({ includeNoAssignee: !state.includeNoAssignee })),
    toggleCreatorFilter: (value) =>
      set((state) => {
        const exists = state.creatorFilters.some(
          (f) => f.type === value.type && f.id === value.id,
        );
        return {
          creatorFilters: exists
            ? state.creatorFilters.filter(
                (f) => !(f.type === value.type && f.id === value.id),
              )
            : [...state.creatorFilters, value],
        };
      }),
    toggleProjectFilter: (projectId) =>
      set((state) => ({
        projectFilters: toggleInList(state.projectFilters, projectId),
      })),
    toggleNoProject: () =>
      set((state) => ({ includeNoProject: !state.includeNoProject })),
    toggleLabelFilter: (labelId) =>
      set((state) => ({
        labelFilters: toggleInList(state.labelFilters, labelId),
      })),
    setSortBy: (sortBy) => set({ sortBy }),
    setSortDirection: (sortDirection) => set({ sortDirection }),
    setGrouping: (grouping) => set({ grouping }),
    clearFilters: () =>
      set({
        statusFilters: [],
        priorityFilters: [],
        assigneeFilters: [],
        includeNoAssignee: false,
        creatorFilters: [],
        projectFilters: [],
        includeNoProject: false,
        labelFilters: [],
      }),
    clearFilterDimension: (dimension) =>
      set((state) => {
        switch (dimension) {
          case "status":
            return { statusFilters: [] };
          case "priority":
            return { priorityFilters: [] };
          case "assignee":
            return { assigneeFilters: [], includeNoAssignee: false };
          case "creator":
            return { creatorFilters: [] };
          case "project":
            return { projectFilters: [], includeNoProject: false };
          case "label":
            return { labelFilters: [] };
        }
      }),
  };
}

/** Convenience selector: does any filter dimension have an active value? */
export function hasActiveIssueFilters(state: IssueFilterSlice): boolean {
  return (
    state.statusFilters.length > 0 ||
    state.priorityFilters.length > 0 ||
    state.assigneeFilters.length > 0 ||
    state.includeNoAssignee ||
    state.creatorFilters.length > 0 ||
    state.projectFilters.length > 0 ||
    state.includeNoProject ||
    state.labelFilters.length > 0
  );
}

/** Map the slice's filter/sort dimensions into the server window params
 *  `GET /api/issues` understands. This is the "wire wiring" half of the
 *  iteration: the query key carries the serialized bag, so changing any
 *  dimension refetches with the new window (like web's table window), and
 *  the client predicate re-runs on top as a belt-and-suspenders pass. */
export function buildIssueWindow(
  state: Pick<
    IssueFilterSlice,
    | "statusFilters"
    | "priorityFilters"
    | "assigneeFilters"
    | "includeNoAssignee"
    | "creatorFilters"
    | "projectFilters"
    | "includeNoProject"
    | "labelFilters"
    | "sortBy"
    | "sortDirection"
  >,
): IssueListWindowParams {
  const window: IssueListWindowParams = {};
  if (state.statusFilters.length > 0) window.statuses = state.statusFilters;
  if (state.priorityFilters.length > 0)
    window.priorities = state.priorityFilters;
  if (state.assigneeFilters.length > 0)
    window.assignee_filters = state.assigneeFilters;
  if (state.includeNoAssignee) window.include_no_assignee = true;
  if (state.creatorFilters.length > 0)
    window.creator_filters = state.creatorFilters;
  if (state.projectFilters.length > 0)
    window.project_ids = state.projectFilters;
  if (state.includeNoProject) window.include_no_project = true;
  if (state.labelFilters.length > 0) window.label_ids = state.labelFilters;
  if (state.sortBy !== "position") window.sort_by = state.sortBy;
  if (state.sortBy !== "position" && state.sortDirection === "desc")
    window.sort_direction = state.sortDirection;
  return window;
}
