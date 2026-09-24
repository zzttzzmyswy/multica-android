/**
 * Autopilots-list scope, filter and sort — mobile port of web
 * `packages/views/autopilots/components/autopilots-page.tsx` (`scopeCounts`
 * :651-660, `scopeRows` :664-669, `rows` :672-725) with the vocabulary from
 * web's autopilots view store
 * (`packages/core/autopilots/stores/view-store.ts`).
 *
 * Web spreads the four filter dimensions across nested dropdown submenus and
 * puts sort + column switches in a display popover. A phone has no hover tree,
 * so the screen presents the same four dimensions as labelled groups of one
 * multi-select sheet and the sort as a chip — the shape the skills and agents
 * lists already use. The key codec below is what lets that sheet speak in flat
 * keys while the filter state stays dimensioned, web's own
 * `toggleFilter(key, value)` shape.
 *
 * Sort semantics are copied exactly, including web's two asymmetries: a
 * never-ran row sorts as the oldest for `lastRun` (epoch 0) and tie-breaks on
 * title ASCENDING regardless of direction, while a missing `nextRun` sorts
 * LAST in either direction rather than as the oldest.
 *
 * Column visibility (web's `hiddenColumns`) is deliberately NOT ported — the
 * mobile list is a card list with no columns to hide.
 */
import type { Autopilot, AutopilotExecutionMode } from "@multica/core/types";

export type AutopilotScope = "all" | "active" | "paused";

export const AUTOPILOT_SCOPES: AutopilotScope[] = ["all", "active", "paused"];

export type AutopilotSortField = "name" | "lastRun" | "nextRun" | "created";
export type AutopilotSortDirection = "asc" | "desc";

/** Presentation order of the sort menu, matching web's `SORT_FIELDS`. */
export const AUTOPILOT_SORT_FIELDS: AutopilotSortField[] = [
  "name",
  "lastRun",
  "nextRun",
  "created",
];

/** Per-field direction applied when the user switches TO that field —
 *  identical to web (view-store.ts `AUTOPILOT_SORT_DEFAULT_DIRECTION`). */
export const AUTOPILOT_SORT_DEFAULT_DIRECTION: Record<
  AutopilotSortField,
  AutopilotSortDirection
> = {
  name: "asc",
  lastRun: "desc",
  nextRun: "asc",
  created: "desc",
};

/** Option order of the trigger-kind group — web's `TRIGGER_KINDS`. */
export const AUTOPILOT_TRIGGER_KINDS = ["schedule", "webhook", "api"] as const;

/** Option order of the mode group — web's `MODES`. */
export const AUTOPILOT_MODES: AutopilotExecutionMode[] = [
  "create_issue",
  "run_only",
];

/** Multi-select filter state. An empty array per dimension = inactive. */
export interface AutopilotListFilters {
  assignees: string[];
  modes: string[];
  triggerKinds: string[];
  creators: string[];
}

export const EMPTY_AUTOPILOT_FILTERS: AutopilotListFilters = {
  assignees: [],
  modes: [],
  triggerKinds: [],
  creators: [],
};

export type AutopilotFilterDimension = keyof AutopilotListFilters;

/**
 * Composite "type:id" value for the polymorphic actor dimensions, so one
 * string list can hold agent and squad references alike. Web's
 * `actorFilterValue` — the filter store is a plain `string[]`.
 */
export function actorFilterValue(type: string, id: string): string {
  return `${type}:${id}`;
}

/**
 * Per-scope totals from the FULL set — filters never affect them, because
 * they are stage inventories rather than result counts. API-archived rows are
 * excluded everywhere: no UI flow creates one.
 */
export function autopilotScopeCounts(
  autopilots: readonly Autopilot[],
): Record<AutopilotScope, number> {
  let active = 0;
  let paused = 0;
  for (const autopilot of autopilots) {
    if (autopilot.status === "archived") continue;
    if (autopilot.status === "paused") paused++;
    else active++;
  }
  return { all: active + paused, active, paused };
}

/**
 * Rows within the current scope, unfiltered — the toolbar's option lists and
 * the "n / total" denominator derive from this, so toggling one filter
 * dimension never makes another dimension's options vanish.
 */
export function autopilotScopeRows(
  autopilots: readonly Autopilot[],
  scope: AutopilotScope,
): Autopilot[] {
  if (scope === "all") {
    return autopilots.filter((a) => a.status !== "archived");
  }
  return autopilots.filter((a) => a.status === scope);
}

export function rowMatchesAutopilotFilters(
  autopilot: Autopilot,
  filters: AutopilotListFilters,
): boolean {
  if (
    filters.assignees.length > 0 &&
    !filters.assignees.includes(
      actorFilterValue(autopilot.assignee_type, autopilot.assignee_id),
    )
  ) {
    return false;
  }
  if (
    filters.modes.length > 0 &&
    !filters.modes.includes(autopilot.execution_mode)
  ) {
    return false;
  }
  // A row carrying ANY of the selected kinds matches — the kinds are a set
  // per row, not a single value.
  if (
    filters.triggerKinds.length > 0 &&
    !(autopilot.trigger_kinds ?? []).some((kind) =>
      filters.triggerKinds.includes(kind),
    )
  ) {
    return false;
  }
  if (
    filters.creators.length > 0 &&
    !filters.creators.includes(
      actorFilterValue(autopilot.created_by_type, autopilot.created_by_id),
    )
  ) {
    return false;
  }
  return true;
}

export function filterAutopilotRows(
  rows: readonly Autopilot[],
  filters: AutopilotListFilters,
): Autopilot[] {
  if (countActiveAutopilotFilterDimensions(filters) === 0) return [...rows];
  return rows.filter((row) => rowMatchesAutopilotFilters(row, filters));
}

/** Non-mutating: the caller's `rows` (often memoized) is never reordered. */
export function sortAutopilotRows(
  rows: readonly Autopilot[],
  field: AutopilotSortField,
  direction: AutopilotSortDirection,
): Autopilot[] {
  const dir = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (field === "name") {
      return a.title.localeCompare(b.title) * dir;
    }
    if (field === "nextRun") {
      // Missing next run sorts LAST regardless of direction — an unscheduled
      // autopilot is not "the soonest", so it must not lead an ascending sort.
      const av = a.next_run_at ? Date.parse(a.next_run_at) : null;
      const bv = b.next_run_at ? Date.parse(b.next_run_at) : null;
      if (av === null && bv === null) return a.title.localeCompare(b.title);
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    }
    if (field === "created") {
      return (Date.parse(a.created_at) - Date.parse(b.created_at)) * dir;
    }
    // lastRun: a never-ran row sorts as the oldest, and equal timestamps
    // tie-break on title ascending whichever direction was chosen.
    const av = a.last_run_at ? Date.parse(a.last_run_at) : 0;
    const bv = b.last_run_at ? Date.parse(b.last_run_at) : 0;
    return (av - bv) * dir || a.title.localeCompare(b.title);
  });
}

/** How many dimensions are narrowing the list — the filter chip's badge. */
export function countActiveAutopilotFilterDimensions(
  filters: AutopilotListFilters,
): number {
  let count = 0;
  if (filters.assignees.length > 0) count++;
  if (filters.modes.length > 0) count++;
  if (filters.triggerKinds.length > 0) count++;
  if (filters.creators.length > 0) count++;
  return count;
}

/**
 * Flat key for one filter option, as the multi-select sheet's row identity.
 * The dimension prefix keeps the four value spaces from colliding and lets
 * `parseAutopilotFilterKey` hand `toggleAutopilotFilter` its arguments back.
 */
export function autopilotFilterKey(
  dimension: AutopilotFilterDimension,
  value: string,
): string {
  return `${dimension}:${value}`;
}

export function parseAutopilotFilterKey(
  key: string,
): { dimension: AutopilotFilterDimension; value: string } | null {
  const separator = key.indexOf(":");
  if (separator <= 0) return null;
  const dimension = key.slice(0, separator);
  const value = key.slice(separator + 1);
  if (
    dimension !== "assignees" &&
    dimension !== "modes" &&
    dimension !== "triggerKinds" &&
    dimension !== "creators"
  ) {
    return null;
  }
  if (!value) return null;
  return { dimension, value };
}

/** Toggle one value in one dimension, returning a new filter object. */
export function toggleAutopilotFilter(
  filters: AutopilotListFilters,
  dimension: AutopilotFilterDimension,
  value: string,
): AutopilotListFilters {
  const list = filters[dimension] as string[];
  const next = list.includes(value)
    ? list.filter((entry) => entry !== value)
    : [...list, value];
  return { ...filters, [dimension]: next } as AutopilotListFilters;
}
