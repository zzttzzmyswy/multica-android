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
import { BOARD_STATUSES } from "@/lib/issue-status";
import type {
  ActorFilterValue,
  IssueFilterSnapshot,
  IssueFilterSlice,
  IssueGrouping,
  IssueSortDirection,
  IssueSortField,
  IssueViewMode,
  PropertyFilterValue,
} from "./issue-filter-slice";

/** Enum lists for sanitization (mirror web baseline: unknown members drop). */
const ALL_STATUSES: readonly IssueStatus[] = [...BOARD_STATUSES, "cancelled"];
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
const VIEW_MODES: readonly IssueViewMode[] = ["list", "board"];

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
    const values = stringArray(selected);
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
 *  Mobile subset of web's display payload — viewMode / grouping / sort
 *  only; web's extra keys (cardProperties, swimlaneGrouping, …) are absent
 *  because mobile has no such surface, and their absence reads back as
 *  defaults. */
export function viewDisplayFromState(state: {
  view: IssueViewMode;
  grouping: IssueGrouping;
  sortBy: IssueSortField;
  sortDirection: IssueSortDirection;
}): Record<string, unknown> {
  return {
    viewMode: state.view,
    grouping: state.grouping,
    sortBy: state.sortBy,
    sortDirection: state.sortDirection,
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

/** Sanitized display patch — viewMode/grouping/sort from a view blob. The
 *  caller supplies the surface's own current sortBy as the fallback so an
 *  unsaved view still lands on the list's active sort. */
export interface IssueViewDisplayPatch {
  viewMode: IssueViewMode;
  grouping: IssueGrouping;
  sortBy: IssueSortField;
  sortDirection: IssueSortDirection;
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

/**
 * True when the live slice is exactly what the view fixes — drives the
 * "modified" dot next to the active view's name. Scope + dateFilter are
 * deliberately excluded (user layers on top, never part of a view).
 */
export function viewMatchesSlice(
  view: Pick<IssueView, "query" | "display">,
  slice: IssueFilterSlice,
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
    wantDisplay.sortDirection === slice.sortDirection
  );
}