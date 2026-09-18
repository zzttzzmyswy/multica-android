/**
 * Saved-issue-view codec (iteration-65): the shared identity of a view is
 * its `query` blob (how web's save-view-dialog serializes it) plus `display`
 * (viewMode/sort/grouping seeds). Both are opaque JSON to the server — the
 * interpretation contract lives client-side, and this module is the mobile
 * half of it. It mirrors web's `baselineFromQuery`
 * (packages/core/issue-views/baseline.ts) and the save dialog's payload
 * exactly, so a view saved on web opens on mobile and vice versa.
 *
 * Two directions:
 * - write: viewQueryFromSnapshot / viewDisplayFromState — current slice →
 *   view blob;
 * - read: sanitizeViewQuery / sanitizeViewDisplay — view blob → a snapshot
 *   patch safe to feed the view store's `resetFiltersTo` / display setters.
 *   Unknown enum members (a newer server, a hand-edited blob) are dropped —
 *   a value the store cannot represent must not enter the snapshot, same
 *   rule as web's baseline.
 *
 * `viewMatchesSlice` drives the "view is modified" dot: the ten fields a
 * saved view fixes are exactly the fields it compares (nine filter dims +
 * view/grouping/sort/sortDirection). dateFilter and scope stay out — they
 * are user layers on top of a view, never part of the view contract.
 */
import type { IssueView } from "@multica/core/api/schemas";
import type { IssuePriority, IssueStatus } from "@multica/core/types";
import {
  propertyIdFromDimension,
  type ActorFilterValue,
  type FilterDimension,
  type IssueFilterSnapshot,
  type IssueFilterSlice,
  type IssueGrouping,
  type IssueSortDirection,
  type IssueSortField,
  type IssueViewMode,
  type PropertyFilterValue,
} from "./issue-filter-slice";

/**
 * Enum lists for sanitization (mirror web baseline: unknown members drop).
 * Kept local instead of importing `@/lib/issue-status`: this module is pure
 * data and must stay importable from the Node vitest lane — issue-status
 * pulls in the i18n runtime, which drags react-native in. The lists mirror
 * BOARD_STATUSES + "cancelled" and the core priority order exactly.
 */
const ALL_STATUSES: readonly IssueStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
];
const ALL_PRIORITIES = ["urgent", "high", "medium", "low", "none"];
const SORT_FIELDS: readonly IssueSortField[] = [
  "position",
  "status",
  "priority",
  "start_date",
  "due_date",
  "created_at",
  "updated_at",
  "title",
];
const SORT_DIRECTIONS: readonly IssueSortDirection[] = ["asc", "desc"];
const GROUPINGS: readonly IssueGrouping[] = ["status", "assignee"];
const VIEW_MODES: readonly IssueViewMode[] = [
  "list",
  "board",
  "table",
  "gantt",
  "swimlane",
];

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === "string")
    : [];
}

function actorArray(value: unknown): ActorFilterValue[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is ActorFilterValue => {
    if (!x || typeof x !== "object") return false;
    const actor = x as ActorFilterValue;
    return (
      typeof actor.id === "string" &&
      (actor.type === "member" || actor.type === "agent" || actor.type === "squad")
    );
  });
}

function stringRecord(value: unknown): PropertyFilterValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record: PropertyFilterValue = {};
  for (const [id, selected] of Object.entries(value as Record<string, unknown>)) {
    // Empty-string options are meaningless in every definition type
    // (select option ids / checkbox "true"/"false" are never empty) — drop
    // them as bad data alongside non-strings.
    const values = stringArray(selected).filter((x) => x.length > 0);
    if (values.length > 0) record[id] = values;
  }
  return record;
}

function firstEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Serialize the nine query-defining filter fields to a view's `query` blob,
 *  mirroring web's save-view-dialog payload
 *  (packages/views/issues/components/save-view-dialog.tsx:585-596). Views are
 *  never created with a date window — date stays a user layer. */
export function viewQueryFromSnapshot(
  snapshot: Pick<
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
  >,
): Record<string, unknown> {
  return {
    statusFilters: snapshot.statusFilters,
    priorityFilters: snapshot.priorityFilters,
    assigneeFilters: snapshot.assigneeFilters,
    includeNoAssignee: snapshot.includeNoAssignee,
    creatorFilters: snapshot.creatorFilters,
    projectFilters: snapshot.projectFilters,
    includeNoProject: snapshot.includeNoProject,
    labelFilters: snapshot.labelFilters,
    propertyFilters: snapshot.propertyFilters,
  };
}

/** Serialize the personal display defaults a view seeds on first open.
 *  Mobile subset of web's display payload — viewMode / grouping / sort /
 *  showSubIssues; web's extra keys (cardProperties, swimlaneGrouping, …) are
 *  absent because mobile has no such surface, and their absence reads back as
 *  defaults. */
export function viewDisplayFromState(state: {
  view: IssueViewMode;
  grouping: IssueGrouping;
  sortBy: IssueSortField;
  sortDirection: IssueSortDirection;
  showSubIssues: boolean;
}): Record<string, unknown> {
  return {
    viewMode: state.view,
    grouping: state.grouping,
    sortBy: state.sortBy,
    sortDirection: state.sortDirection,
    showSubIssues: state.showSubIssues,
  };
}

/** Enum-sanitized snapshot straight from a view blob — safe to hand to
 *  `resetFiltersTo`. Unknown members drop; missing fields default. */
export function sanitizeViewQuery(query: Record<string, unknown>): IssueFilterSnapshot {
  return {
    statusFilters: stringArray(query.statusFilters).filter((s): s is IssueStatus =>
      (ALL_STATUSES as readonly string[]).includes(s),
    ),
    priorityFilters: stringArray(query.priorityFilters).filter((p): p is IssuePriority =>
      (ALL_PRIORITIES as readonly string[]).includes(p),
    ),
    assigneeFilters: actorArray(query.assigneeFilters),
    includeNoAssignee: query.includeNoAssignee === true,
    creatorFilters: actorArray(query.creatorFilters),
    projectFilters: stringArray(query.projectFilters),
    includeNoProject: query.includeNoProject === true,
    labelFilters: stringArray(query.labelFilters),
    propertyFilters: stringRecord(query.propertyFilters),
  };
}

/** The nine filter dims a saved view fixes, plus the user-layer date window
 *  — the shape the filter chips read. Structurally the surfaces'
 *  `IssueFilterState` (lib/filter-issues.ts), declared here because that
 *  module pulls the i18n runtime and this one must stay Node-testable. */
export type IssueFilterDims = Pick<
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
>;

/** The open saved view's query, normalized for the two jobs web's
 *  `IssueViewBaseline` (packages/core/issue-views/baseline.ts) does:
 *  - membership (`has` sets): the chip bar subtracts view-fixed VALUES, so
 *    the view's own conditions never appear as chips — the view name
 *    carries them and chips only show what the user layered on top;
 *  - resets (`raw`): removing a user-added chip returns its dimension to
 *    the view's values, never to empty. */
export interface IssueViewBaseline {
  status: Set<string>;
  priority: Set<string>;
  /** Actor keys as `${type}:${id}`. */
  assignee: Set<string>;
  includeNoAssignee: boolean;
  creator: Set<string>;
  project: Set<string>;
  includeNoProject: boolean;
  label: Set<string>;
  /** Property definition id → fixed option ids. */
  property: Map<string, Set<string>>;
  /** Enum-sanitized snapshot, safe to hand straight to `resetFiltersTo`. */
  raw: IssueFilterSnapshot;
}

export function actorBaselineKey(actor: ActorFilterValue): string {
  return `${actor.type}:${actor.id}`;
}

/** Mirror of web's `baselineFromQuery` — the mobile half of the same
 *  contract, fed by `sanitizeViewQuery` so a value the store cannot
 *  represent never enters the baseline. */
export function baselineFromViewQuery(
  query: Record<string, unknown>,
): IssueViewBaseline {
  const raw = sanitizeViewQuery(query);
  const property = new Map<string, Set<string>>();
  for (const [id, selected] of Object.entries(raw.propertyFilters)) {
    if (selected.length > 0) property.set(id, new Set(selected));
  }
  return {
    status: new Set(raw.statusFilters),
    priority: new Set(raw.priorityFilters),
    assignee: new Set(raw.assigneeFilters.map(actorBaselineKey)),
    includeNoAssignee: raw.includeNoAssignee,
    creator: new Set(raw.creatorFilters.map(actorBaselineKey)),
    project: new Set(raw.projectFilters),
    includeNoProject: raw.includeNoProject,
    label: new Set(raw.labelFilters),
    property,
    raw,
  };
}

/** What the chip bar renders: the user's additions on top of the open view.
 *  Without a baseline this is the live slice verbatim. */
export interface IssueFilterDelta {
  statuses: IssueStatus[];
  priorities: IssuePriority[];
  assignees: ActorFilterValue[];
  includeNoAssignee: boolean;
  creators: ActorFilterValue[];
  projects: string[];
  includeNoProject: boolean;
  labels: string[];
  property: PropertyFilterValue;
}

export function issueFilterDelta(
  state: IssueFilterDims,
  baseline: IssueViewBaseline | null,
): IssueFilterDelta {
  if (!baseline) {
    return {
      statuses: state.statusFilters,
      priorities: state.priorityFilters,
      assignees: state.assigneeFilters,
      includeNoAssignee: state.includeNoAssignee,
      creators: state.creatorFilters,
      projects: state.projectFilters,
      includeNoProject: state.includeNoProject,
      labels: state.labelFilters,
      property: state.propertyFilters,
    };
  }
  const property: PropertyFilterValue = {};
  for (const [id, selected] of Object.entries(state.propertyFilters)) {
    const fixed = baseline.property.get(id);
    const delta = fixed ? selected.filter((v) => !fixed.has(v)) : selected;
    if (delta.length > 0) property[id] = delta;
  }
  return {
    statuses: state.statusFilters.filter((s) => !baseline.status.has(s)),
    priorities: state.priorityFilters.filter((p) => !baseline.priority.has(p)),
    assignees: state.assigneeFilters.filter(
      (a) => !baseline.assignee.has(actorBaselineKey(a)),
    ),
    includeNoAssignee: state.includeNoAssignee && !baseline.includeNoAssignee,
    creators: state.creatorFilters.filter(
      (a) => !baseline.creator.has(actorBaselineKey(a)),
    ),
    projects: state.projectFilters.filter((id) => !baseline.project.has(id)),
    includeNoProject: state.includeNoProject && !baseline.includeNoProject,
    labels: state.labelFilters.filter((id) => !baseline.label.has(id)),
    property,
  };
}

/**
 * Reset ONE dimension to the open view's values — web's `clearDimension`
 * (filter-chips-bar.tsx:188-236). Paired flags travel with their dimension
 * (no-assignee with assignee, no-project with project); a property
 * definition the view does not fix loses its entry entirely. The date
 * window is a user layer no view carries, so it is never restored here (the
 * date chip clears itself).
 */
export function clearDimensionToBaseline(
  state: IssueFilterDims,
  dimension: FilterDimension,
  baseline: IssueViewBaseline,
): IssueFilterSnapshot {
  const raw = baseline.raw;
  const current: IssueFilterSnapshot = {
    statusFilters: state.statusFilters,
    priorityFilters: state.priorityFilters,
    assigneeFilters: state.assigneeFilters,
    includeNoAssignee: state.includeNoAssignee,
    creatorFilters: state.creatorFilters,
    projectFilters: state.projectFilters,
    includeNoProject: state.includeNoProject,
    labelFilters: state.labelFilters,
    propertyFilters: state.propertyFilters,
  };
  switch (dimension) {
    case "status":
      return { ...current, statusFilters: raw.statusFilters };
    case "priority":
      return { ...current, priorityFilters: raw.priorityFilters };
    case "assignee":
      return {
        ...current,
        assigneeFilters: raw.assigneeFilters,
        includeNoAssignee: raw.includeNoAssignee,
      };
    case "creator":
      return { ...current, creatorFilters: raw.creatorFilters };
    case "project":
      return {
        ...current,
        projectFilters: raw.projectFilters,
        includeNoProject: raw.includeNoProject,
      };
    case "label":
      return { ...current, labelFilters: raw.labelFilters };
    default: {
      const propertyId = propertyIdFromDimension(dimension);
      if (!propertyId) return current;
      const propertyFilters = { ...current.propertyFilters };
      const base = raw.propertyFilters[propertyId];
      if (base) propertyFilters[propertyId] = base;
      else delete propertyFilters[propertyId];
      return { ...current, propertyFilters };
    }
  }
}

/** Sanitized display patch — viewMode/grouping/sort/showSubIssues from a
 *  view blob. The caller supplies the surface's own current sortBy as the
 *  fallback so an unsaved view still lands on the list's active sort. */
export interface IssueViewDisplayPatch {
  viewMode: IssueViewMode;
  grouping: IssueGrouping;
  sortBy: IssueSortField;
  sortDirection: IssueSortDirection;
  showSubIssues: boolean;
}

export function sanitizeViewDisplay(
  display: Record<string, unknown>,
  defaultSortBy: IssueSortField,
): IssueViewDisplayPatch {
  return {
    viewMode: firstEnum(display.viewMode, VIEW_MODES, "list"),
    grouping: firstEnum(display.grouping, GROUPINGS, "status"),
    sortBy: firstEnum(display.sortBy, SORT_FIELDS, defaultSortBy),
    sortDirection: firstEnum(display.sortDirection, SORT_DIRECTIONS, "asc"),
    // Web's view-store default is `true`; a view that predates the key (or
    // carries a non-boolean) keeps sub-issues visible.
    showSubIssues: display.showSubIssues !== false,
  };
}

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameActors(a: ActorFilterValue[], b: ActorFilterValue[]): boolean {
  return (
    a.length === b.length &&
    a.every((v, i) => v.type === b[i].type && v.id === b[i].id)
  );
}

/** The live-window fields a saved view captures — the nine filter dims plus
 *  the display defaults. Structural so either surface can pass its own
 *  filter state object (workspace Issues and My Issues keep separate
 *  stores). */
export type IssueViewSnapshotSource = Pick<
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
  | "sortBy"
  | "sortDirection"
  | "grouping"
  | "showSubIssues"
>;

/**
 * True when the live slice is exactly what the view fixes — drives the
 * "modified" dot next to the active view's name. Scope + dateFilter are
 * deliberately excluded (user layers on top, never part of a view).
 */
export function viewMatchesSlice(
  view: Pick<IssueView, "query" | "display">,
  slice: IssueViewSnapshotSource,
  viewMode: IssueViewMode,
): boolean {
  const want = sanitizeViewQuery(view.query);
  const curr = sanitizeViewQuery(viewQueryFromSnapshot(slice));

  if (
    want.includeNoAssignee !== curr.includeNoAssignee ||
    want.includeNoProject !== curr.includeNoProject ||
    !sameStrings(want.statusFilters, curr.statusFilters) ||
    !sameStrings(want.priorityFilters, curr.priorityFilters) ||
    !sameActors(want.assigneeFilters, curr.assigneeFilters) ||
    !sameActors(want.creatorFilters, curr.creatorFilters) ||
    !sameStrings(want.projectFilters, curr.projectFilters) ||
    !sameStrings(want.labelFilters, curr.labelFilters)
  ) {
    return false;
  }
  const wantKeys = Object.keys(want.propertyFilters);
  const currKeys = Object.keys(curr.propertyFilters);
  if (
    wantKeys.length !== currKeys.length ||
    !wantKeys.every((k) => sameStrings(want.propertyFilters[k] ?? [], curr.propertyFilters[k] ?? []))
  ) {
    return false;
  }
  const wantDisplay = sanitizeViewDisplay(view.display, slice.sortBy);
  return (
    wantDisplay.viewMode === viewMode &&
    wantDisplay.grouping === slice.grouping &&
    wantDisplay.sortBy === slice.sortBy &&
    wantDisplay.sortDirection === slice.sortDirection &&
    wantDisplay.showSubIssues === slice.showSubIssues
  );
}