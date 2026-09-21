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
import { dateOnlyToLocalDate } from "@multica/core/issues/date";
import { BOARD_STATUSES } from "@/lib/issue-status-core";
import type { IssueListWindowParams } from "@/data/queries/issue-keys";

/** The full status order, used as the complement base when hiding a column.
 *  Same list web's `ALL_STATUSES` is; `issue-status-core.test.ts` holds the
 *  two equal. */
const ALL_STATUSES: readonly IssueStatus[] = BOARD_STATUSES;

export type ActorFilterValue = {
  type: "member" | "agent" | "squad";
  id: string;
};

/** Static sort keys, mirroring web `SORT_OPTIONS`. Custom-property keys are
 *  the same union widened with the `property:<definitionId>` form
 *  (view-store.ts:23-36) — see `propertyViewKey`. */
export type StaticIssueSortField =
  | "position"
  | "status"
  | "priority"
  | "start_date"
  | "due_date"
  | "created_at"
  | "updated_at"
  | "title";

export type IssueSortField = StaticIssueSortField | `property:${string}`;

export type IssueSortDirection = "asc" | "desc";

/** Grouping mirroring web `GROUPING_OPTIONS` (status / assignee), widened
 *  with web's `property:<definitionId>` select-property form
 *  (view-store.ts:20). */
export type StaticIssueGrouping = "status" | "assignee";

export type IssueGrouping = StaticIssueGrouping | `property:${string}`;

/**
 * Custom-property filter snapshot mirroring web's
 * `view-store.ts` `propertyFilters`: definition id → selected option ids
 * (checkbox definitions use the pseudo-options "true"/"false"). Empty array
 * = no filter for that definition; matching is OR within a definition and
 * AND across definitions, like every other filter group.
 */
export type PropertyFilterValue = Record<string, string[]>;

/** Date window mirroring web's `IssueDateFilter` (calendar-day, no time).
 *  `field` picks which issue timestamp participates; `from`/`to` are
 *  date-only "YYYY-MM-DD" strings (local calendar). */
export interface IssueDateFilterValue {
  field: "created_at" | "updated_at";
  from: string;
  to: string;
}

/**
 * Issue-workbench view mode. Mobile surface of web `ViewMode` — gantt added
 * in iter-118, swimlane in iter-122 (its lane model lives in
 * `lib/swimlane.ts`). Lives here so all issue-list view stores share one
 * wire default, but the field itself lives on each store (like `scope`),
 * NOT in the filter slice — clearing filters must not reset the user's
 * chosen view.
 */
export type IssueViewMode = "list" | "board" | "table" | "gantt" | "swimlane";

export const ISSUE_VIEW_MODES: { value: IssueViewMode; labelKey: string }[] = [
  { value: "list", labelKey: "issues.viewList" },
  { value: "board", labelKey: "issues.viewBoard" },
  { value: "table", labelKey: "issues.viewTable" },
  { value: "gantt", labelKey: "issues.viewGantt" },
  { value: "swimlane", labelKey: "issues.viewSwimlane" },
];

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

/** The nine query-defining filter fields as one value — what a saved view
 *  fixes, and what `resetFiltersTo` restores. Mirrors web
 *  `view-store.ts` `FilterSnapshot` field-for-field so the same blob opens
 *  the same visible set on either client. Date is excluded: `dateFilter`
 *  lives outside the snapshot (views never carry a date window). */
export interface IssueFilterSnapshot {
  statusFilters: IssueStatus[];
  priorityFilters: IssuePriority[];
  assigneeFilters: ActorFilterValue[];
  includeNoAssignee: boolean;
  creatorFilters: ActorFilterValue[];
  projectFilters: string[];
  includeNoProject: boolean;
  labelFilters: string[];
  propertyFilters: PropertyFilterValue;
}

export interface IssueFilterSlice {
  statusFilters: IssueStatus[];
  priorityFilters: IssuePriority[];
  assigneeFilters: ActorFilterValue[];
  includeNoAssignee: boolean;
  creatorFilters: ActorFilterValue[];
  projectFilters: string[];
  includeNoProject: boolean;
  labelFilters: string[];
  propertyFilters: PropertyFilterValue;
  dateFilter: IssueDateFilterValue | null;
  /**
   * Show only issues with a RUNNING agent task (web `agentRunningFilter` →
   * `workingOnly`). Deliberately NOT persisted and NOT part of
   * `IssueFilterSnapshot`: running state changes second-to-second, so a
   * stored toggle would let the user return to an unexplained empty list.
   * Web reaches the same conclusion at view-store.ts:525-531.
   */
  workingOnly: boolean;
  sortBy: IssueSortField;
  sortDirection: IssueSortDirection;
  grouping: IssueGrouping;
  /**
   * When false, issues that HAVE a parent (sub-issues) are hidden from every
   * issue surface so the user can focus on top-level parents. Purely a
   * display filter — the parent/child relationship is untouched. Mirrors web
   * `view-store.ts:203-205` (default true, `toggleShowSubIssues`). Unlike
   * `workingOnly` this IS a saved view's display default, so it travels in
   * `IssueViewSnapshotSource` / the view codec's display payload rather than
   * in `IssueFilterSnapshot` — and `clearFilters` leaves it alone, exactly
   * like web's (view-store.ts:401-415).
   */
  showSubIssues: boolean;
  toggleStatusFilter: (status: IssueStatus) => void;
  /**
   * Hide one status column from the kanban surfaces (board / swimlane).
   *
   * This writes `statusFilters` rather than a separate `hiddenStatuses` list,
   * which is exactly what web does (`view-store.ts:385-400`): the two are the
   * same fact stated two ways, and keeping one source means the server window
   * (`buildIssueWindow` → `statuses`) narrows with it. A parallel hidden list
   * would need its own wiring into the window and would drift the moment a
   * status filter chip is added or removed.
   *
   * An EMPTY filter list means "everything shows" (not "nothing"), so the
   * first hide has to materialise the complement — see `hiddenStatuses`.
   */
  hideStatus: (status: IssueStatus) => void;
  /** Restore one status column hidden by `hideStatus`. No-op when nothing is
   *  hidden, so a "show" on an already-visible column cannot narrow the
   *  window. */
  showStatus: (status: IssueStatus) => void;
  togglePriorityFilter: (priority: IssuePriority) => void;
  toggleAssigneeFilter: (value: ActorFilterValue) => void;
  toggleNoAssignee: () => void;
  toggleCreatorFilter: (value: ActorFilterValue) => void;
  toggleProjectFilter: (projectId: string) => void;
  toggleNoProject: () => void;
  toggleLabelFilter: (labelId: string) => void;
  /** Toggle one option of a custom-property definition (OR within a
   *  definition). Dropping the last selected option removes the definition
   *  from the record — an empty record on the wire is no filter. */
  togglePropertyFilter: (propertyId: string, optionId: string) => void;
  /** Drop every selection of one custom-property definition. */
  clearPropertyFilter: (propertyId: string) => void;
  setDateFilter: (filter: IssueDateFilterValue | null) => void;
  /** Flip the "only issues an agent is working on" quick filter. */
  toggleWorkingOnly: () => void;
  /** Flip the "show sub-issues" display filter (web `toggleShowSubIssues`). */
  toggleShowSubIssues: () => void;
  setSortBy: (field: IssueSortField) => void;
  setSortDirection: (dir: IssueSortDirection) => void;
  setGrouping: (grouping: IssueGrouping) => void;
  clearFilters: () => void;
  /** Replace every filter field at once — how opening a saved view returns
   *  to the view's own conditions instead of to the prior session state.
   *  Mirrors web `view-store.ts` `resetFiltersTo`. Like web, `dateFilter`
   *  is NOT part of the snapshot (views never carry a date window). */
  resetFiltersTo: (snapshot: IssueFilterSnapshot) => void;
  /** Clear one filter dimension (a filter-bar chip). Paired boolean flags
   *  (no-assignee / no-project) clear with their dimension — matches web's
   *  `clearFilterDimension`. `property:<id>` clears that definition's entry
   *  only; `"date"` clears the date window. */
  clearFilterDimension: (dimension: FilterDimension) => void;
}

export type FilterDimension =
  | "status"
  | "priority"
  | "assignee"
  | "creator"
  | "project"
  | "label"
  | "date"
  | `property:${string}`;

export const PROPERTY_FILTER_PREFIX = "property:";

/** Build the sort/grouping view key for a custom-property definition. Web's
 *  `property:${id}` (view-store.ts:138-140) — the same prefix the filter
 *  dimension uses, since a saved view carries all three in one vocabulary. */
export function propertyViewKey(propertyId: string): `property:${string}` {
  return `${PROPERTY_FILTER_PREFIX}${propertyId}`;
}

/** Strip the `property:` prefix off a sort/grouping view key; null when the
 *  key is a static field. */
export function propertyIdFromViewKey(key: string): string | null {
  return key.startsWith(PROPERTY_FILTER_PREFIX)
    ? key.slice(PROPERTY_FILTER_PREFIX.length)
    : null;
}

/** Strip the dimension prefix off a property chip key. */
export function propertyIdFromDimension(
  dimension: FilterDimension,
): string | null {
  return dimension.startsWith(PROPERTY_FILTER_PREFIX)
    ? dimension.slice(PROPERTY_FILTER_PREFIX.length)
    : null;
}

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
  | "propertyFilters"
  | "dateFilter"
  | "workingOnly"
  | "sortBy"
  | "sortDirection"
  | "grouping"
  | "showSubIssues"
> => ({
  statusFilters: [],
  priorityFilters: [],
  assigneeFilters: [],
  includeNoAssignee: false,
  creatorFilters: [],
  projectFilters: [],
  includeNoProject: false,
  labelFilters: [],
  propertyFilters: {},
  dateFilter: null,
  workingOnly: false,
  sortBy: "position",
  sortDirection: "asc",
  grouping: "status",
  showSubIssues: true,
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
  | "hideStatus"
  | "showStatus"
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
  | "togglePropertyFilter"
  | "clearPropertyFilter"
  | "setDateFilter"
  | "toggleWorkingOnly"
  | "toggleShowSubIssues"
  | "clearFilters"
  | "resetFiltersTo"
  | "clearFilterDimension"
> {
  const toggleInList = <T,>(list: T[], item: T): T[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  return {
    toggleStatusFilter: (status: IssueStatus) =>
      set((state) => ({
        statusFilters: toggleInList(state.statusFilters, status),
      })),
    hideStatus: (status: IssueStatus) =>
      set((state) => ({
        statusFilters: hideOneStatus(
          state.statusFilters,
          status,
          BOARD_STATUSES,
        ),
      })),
    showStatus: (status: IssueStatus) =>
      set((state) => ({
        statusFilters: showOneStatus(state.statusFilters, status),
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
    togglePropertyFilter: (propertyId, optionId) =>
      set((state) => {
        const current = state.propertyFilters[propertyId] ?? [];
        const next = current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId];
        const propertyFilters = { ...state.propertyFilters };
        if (next.length === 0) delete propertyFilters[propertyId];
        else propertyFilters[propertyId] = next;
        return { propertyFilters };
      }),
    clearPropertyFilter: (propertyId) =>
      set((state) => {
        if (!(propertyId in state.propertyFilters)) return state;
        const propertyFilters = { ...state.propertyFilters };
        delete propertyFilters[propertyId];
        return { propertyFilters };
      }),
    setDateFilter: (dateFilter) => set({ dateFilter }),
    toggleWorkingOnly: () =>
      set((state) => ({ workingOnly: !state.workingOnly })),
    toggleShowSubIssues: () =>
      set((state) => ({ showSubIssues: !state.showSubIssues })),
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
        propertyFilters: {},
        dateFilter: null,
        workingOnly: false,
      }),
    resetFiltersTo: (snapshot) => set({ ...snapshot }),
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
          case "date":
            return { dateFilter: null };
          default: {
            const propertyId = propertyIdFromDimension(dimension);
            if (!propertyId || !(propertyId in state.propertyFilters)) {
              return state;
            }
            const propertyFilters = { ...state.propertyFilters };
            delete propertyFilters[propertyId];
            return { propertyFilters };
          }
        }
      }),
  };
}

/**
 * The status columns the kanban surfaces are NOT showing.
 *
 * Derived from `statusFilters` rather than stored separately — see the
 * `hideStatus` doc. `statusFilters` empty means "no status restriction", i.e.
 * nothing is hidden; a NON-empty list is the visible set, so the hidden set is
 * its complement over the full status order.
 */
export function hiddenStatuses(
  statusFilters: readonly IssueStatus[],
): IssueStatus[] {
  if (statusFilters.length === 0) return [];
  const visible = new Set(statusFilters);
  return ALL_STATUSES.filter((s) => !visible.has(s));
}

/** Whether one status column is currently hidden (web `hiddenStatuses.includes`). */
export function isStatusHidden(
  statusFilters: readonly IssueStatus[],
  status: IssueStatus,
): boolean {
  return statusFilters.length > 0 && !statusFilters.includes(status);
}

/**
 * `hideStatus` as a pure transform: drop `status` from the visible set,
 * materialising the full complement first when nothing is filtered yet.
 * Without that materialisation an empty filter list (which means "show
 * everything") would be indistinguishable from "hide everything".
 */
export function hideOneStatus(
  statusFilters: readonly IssueStatus[],
  status: IssueStatus,
  allStatuses: readonly IssueStatus[],
): IssueStatus[] {
  const visible =
    statusFilters.length === 0 ? [...allStatuses] : [...statusFilters];
  return visible.filter((s) => s !== status);
}

/** `showStatus` as a pure transform. Adding to an empty list would mean "show
 *  ONLY this one" — the opposite of the user's intent — so it stays a no-op
 *  until something is actually hidden. */
export function showOneStatus(
  statusFilters: readonly IssueStatus[],
  status: IssueStatus,
): IssueStatus[] {
  if (statusFilters.length === 0) return [...statusFilters];
  if (statusFilters.includes(status)) return [...statusFilters];
  return [...statusFilters, status];
}

/** Convenience selector: does any filter dimension have an active value?
 *
 *  `workingOnly` counts. Web's header keeps its agents-working chip on a
 *  separate code path from `getActiveFilterCount`, but mobile has no room
 *  for a second header chip (the toolbar already carries the scope pills,
 *  the five-button mode switch and the filter trigger) — so the filter
 *  sheet IS its surface, and an active-only-here dimension that left the
 *  trigger unlit would be invisible the moment the sheet closed.
 *
 *  Takes the value shape rather than the whole slice so the issue-list
 *  surfaces (which assemble a plain `IssueFilterState` from per-field store
 *  subscriptions) can reuse it instead of re-deriving the predicate. */
export function hasActiveIssueFilters(
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
    | "propertyFilters"
    | "dateFilter"
    | "workingOnly"
  >,
): boolean {
  return (
    state.statusFilters.length > 0 ||
    state.priorityFilters.length > 0 ||
    state.assigneeFilters.length > 0 ||
    state.includeNoAssignee ||
    state.creatorFilters.length > 0 ||
    state.projectFilters.length > 0 ||
    state.includeNoProject ||
    state.labelFilters.length > 0 ||
    Object.keys(state.propertyFilters).length > 0 ||
    state.dateFilter !== null ||
    state.workingOnly
  );
}

/**
 * Convert the date-only window to the half-open instant band the server
 * expects. Mirrors web's `issueDateFilterToApiParams`
 * (packages/views/issues/surface/use-issue-surface-controller.ts:129-152):
 * local-midnight of `from` … local-midnight of `to` + 1 day, emitted as
 * ISO instants. Ordering of from/to is normalized (from ≤ to).
 */
export function dateFilterToWindowParams(
  filter: IssueDateFilterValue,
): Pick<IssueListWindowParams, "date_field" | "date_start" | "date_end"> {
  const from = dateOnlyToLocalDate(filter.from);
  const to = dateOnlyToLocalDate(filter.to);
  if (!from || !to) return {};
  const start = from <= to ? from : to;
  const endSource = from <= to ? to : from;
  const end = new Date(endSource);
  end.setDate(end.getDate() + 1);
  return {
    date_field: filter.field,
    date_start: start.toISOString(),
    date_end: end.toISOString(),
  };
}

/** Map the slice's filter/sort dimensions into the server window params
 *  `GET /api/issues` understands. This is the "wire wiring" half of the
 *  iteration: the query key carries the serialized bag, so changing any
 *  dimension refetches with the new window (like web's table window), and
 *  the client predicate re-runs on top as a belt-and-suspenders pass.
 *
 *  `q` is the Table's quick search, and it belongs in the WINDOW rather than
 *  in a client-side filter for the same reason web sends it: the server
 *  matches title words AND the immutable issue number, so a number search
 *  finds rows the loaded pages do not contain, and the CSV export (which
 *  serializes exactly the rows the table shows) exports what was searched. */
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
    | "propertyFilters"
    | "dateFilter"
    | "sortBy"
    | "sortDirection"
  > & {
    /** Table quick search. Empty/whitespace means "no search" — the server
     *  treats a blank `q` as absent, and an empty string here would still
     *  change the query key and refetch for nothing. */
    tableSearch?: string;
  },
): IssueListWindowParams {
  const window: IssueListWindowParams = {};
  const q = state.tableSearch?.trim();
  if (q) window.q = q;
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
  if (Object.keys(state.propertyFilters).length > 0)
    window.properties = state.propertyFilters;
  if (state.dateFilter) {
    const band = dateFilterToWindowParams(state.dateFilter);
    if (band.date_field) window.date_field = band.date_field;
    if (band.date_start) window.date_start = band.date_start;
    if (band.date_end) window.date_end = band.date_end;
  }
  if (state.sortBy !== "position") window.sort_by = state.sortBy;
  if (state.sortBy !== "position" && state.sortDirection === "desc")
    window.sort_direction = state.sortDirection;
  return window;
}
