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
// Type-only, like the slice's own import of it.
import type { CardProperties } from "@multica/core/issues";
import { BOARD_STATUSES } from "@/lib/issue-status-core";
import {
  PROPERTY_COLUMN_PREFIX,
  TABLE_SYSTEM_COLUMNS,
  clampColumnWidth,
  defaultTableColumnWidths,
  defaultTableColumns,
  type TableColumnKey,
  type TableColumnWidths,
} from "./issue-table-columns";
import type { IssueTableGrouping } from "@/lib/issue-table-groups";
import type { SwimlaneGrouping } from "@/lib/swimlane";
import {
  propertyIdFromDimension,
  type ActorFilterValue,
  type FilterDimension,
  type IssueDateFilterValue,
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
 * Statuses come straight from `@/lib/issue-status-core` — a pure module, so
 * it is importable from the Node vitest lane and cannot drift from the column
 * order the list actually renders. Priorities are the core order.
 */
const ALL_STATUSES: readonly IssueStatus[] = BOARD_STATUSES;
const ALL_PRIORITIES = ["urgent", "high", "medium", "low", "none"];
/** Renderable system-column keys — `TABLE_SYSTEM_COLUMNS` is the single
 *  source, so a column the menu offers and a column the reader accepts cannot
 *  drift apart. */
const TABLE_SYSTEM_COLUMN_KEYS: ReadonlySet<string> = new Set(
  TABLE_SYSTEM_COLUMNS.map((c) => c.key),
);
const SWIMLANE_GROUPING_VALUES: readonly SwimlaneGrouping[] = [
  "assignee",
  "project",
  "parent",
];
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

/** Serialize the personal display defaults a view seeds on first open —
 *  the same key set web's save-view-dialog writes
 *  (`save-view-dialog.tsx:598-614`): viewMode / grouping / sort / sortDirection
 *  / showSubIssues / cardProperties / cardPropertyIds / tableColumns /
 *  tableGrouping / tableHierarchy / swimlaneGrouping.
 *
 *  **This comment used to justify their absence by saying the mobile client
 *  had no swimlane or table surface. That became false when both shipped, and
 *  it stayed on the file long enough to be quoted as a reason not to fix the
 *  gap (MYS-2255). Mobile HAS all three surfaces; the payload was simply never
 *  extended.** The consequence was a one-way loss: open a web-saved view on
 *  the phone, adjust anything, re-save → the view's swimlane dimension, its
 *  column set/order and its table grouping were overwritten with mobile's
 *  defaults for every client, web included.
 *
 *  `tableColumns` is written in WEB'S shape — `{ key, width? }[]`
 *  (`view-store.ts:55-58`) — not mobile's `TableColumnKey[]`: mobile keeps
 *  widths in a separate sparse `tableColumnWidths` bag (an absent entry means
 *  "still at the default", so a default change reaches columns the user never
 *  touched). The pair is folded into web's shape on write and split again on
 *  read, which is what makes the round trip lossless in both directions. */
export function viewDisplayFromState(state: {
  view: IssueViewMode;
  grouping: IssueGrouping;
  sortBy: IssueSortField;
  sortDirection: IssueSortDirection;
  showSubIssues: boolean;
  tableHierarchy: boolean;
  cardProperties: CardProperties;
  cardPropertyIds: string[];
  swimlaneGrouping: SwimlaneGrouping;
  tableColumns: readonly TableColumnKey[];
  tableColumnWidths: TableColumnWidths;
  tableGrouping: IssueTableGrouping;
}): Record<string, unknown> {
  return {
    viewMode: state.view,
    grouping: state.grouping,
    sortBy: state.sortBy,
    sortDirection: state.sortDirection,
    showSubIssues: state.showSubIssues,
    tableHierarchy: state.tableHierarchy,
    cardProperties: state.cardProperties,
    cardPropertyIds: state.cardPropertyIds,
    swimlaneGrouping: state.swimlaneGrouping,
    // Web's `TableColumnConfig[]`. A width the user never dragged stays
    // absent rather than being pinned to today's default.
    tableColumns: state.tableColumns.map((key) => {
      const width = state.tableColumnWidths[key];
      return width == null ? { key } : { key, width };
    }),
    tableGrouping: state.tableGrouping,
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

/** Sanitized display patch — viewMode/grouping/sort/showSubIssues/
 *  tableHierarchy/cardProperties/cardPropertyIds plus the three canvas-shape
 *  dimensions (swimlaneGrouping / tableColumns / tableGrouping) from a view
 *  blob. The caller supplies the surface's own current sortBy as the fallback
 *  so an unsaved view still lands on the list's active sort. */
export interface IssueViewDisplayPatch {
  viewMode: IssueViewMode;
  grouping: IssueGrouping;
  sortBy: IssueSortField;
  sortDirection: IssueSortDirection;
  showSubIssues: boolean;
  tableHierarchy: boolean;
  cardProperties: CardProperties;
  cardPropertyIds: string[];
  swimlaneGrouping: SwimlaneGrouping;
  /** Visible columns in display order — `title` always first, as the store
   *  requires (`issue-table-columns.ts` pins it). */
  tableColumns: TableColumnKey[];
  /** Width overrides only; an un-resized column has no entry. */
  tableColumnWidths: TableColumnWidths;
  tableGrouping: IssueTableGrouping;
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
    // Same rule and same reasoning as `showSubIssues` above: web's default is
    // `true` (view-store.ts:309), so only an explicit `false` turns nesting
    // off. A view saved before the key existed keeps the table nested.
    tableHierarchy: display.tableHierarchy !== false,
    // Per-key boolean fallback, defaulting each missing / non-boolean key to
    // `true` — web's own default for every one of the eight (view-store.ts
    // :287-296) and the same rule `showSubIssues` above follows. A view saved
    // before a toggle existed must not read that toggle as off.
    cardProperties: sanitizeCardProperties(display.cardProperties),
    // Kept verbatim, unknown ids included — see `sanitizeCardPropertyIds`.
    cardPropertyIds: sanitizeCardPropertyIds(display.cardPropertyIds),
    swimlaneGrouping: sanitizeSwimlaneGrouping(display.swimlaneGrouping),
    ...sanitizeTableColumns(display.tableColumns),
    tableGrouping: sanitizeTableGrouping(display.tableGrouping),
  };
}

/**
 * Swimlane dimension — web's three values (`view-store.ts:21`), default
 * `assignee` (`:302`). Same rule as every other enum here: a member the store
 * cannot represent falls back rather than entering the snapshot.
 */
function sanitizeSwimlaneGrouping(raw: unknown): SwimlaneGrouping {
  return firstEnum(raw, SWIMLANE_GROUPING_VALUES, "assignee");
}

/**
 * The table's visible columns + width overrides, from web's
 * `TableColumnConfig[]` (`view-store.ts:55-58`).
 *
 * Four rules, each mirroring a guarantee the store makes:
 *
 *   1. **`title` is pinned first.** The store's `toggleTableColumn` /
 *      `reorderTableColumn` both refuse to move or hide it, and the table
 *      view renders `columns[0]` as the pinned column. A blob that omits it
 *      (or lists it late) would otherwise render a table with no pinned
 *      column.
 *   2. **Duplicates drop, first occurrence wins** — `mergeViewStatePersisted`
 *      dedupes the same way for persisted snapshots.
 *   3. **Unknown keys drop.** A key must be a system column this build can
 *      render or a `property:` column; anything else is a newer build's
 *      column and would paint an empty cell forever.
 *   4. **Widths clamp into the draggable range** — the same floor/ceiling the
 *      resize gesture uses (`clampColumnWidth`), so a width saved by another
 *      client cannot make a column unusable on a phone.
 *
 * A blob with NO usable columns falls back to the full default set rather than
 * an empty table: "the view never stored columns" and "the view stored only
 * columns this build dropped" both mean the user has no column preference to
 * honour.
 */
function sanitizeTableColumns(raw: unknown): {
  tableColumns: TableColumnKey[];
  tableColumnWidths: TableColumnWidths;
} {
  if (!Array.isArray(raw)) {
    return {
      tableColumns: defaultTableColumns(),
      tableColumnWidths: defaultTableColumnWidths(),
    };
  }
  const seen = new Set<TableColumnKey>();
  const widths: TableColumnWidths = {};
  let pinnedTitle = false;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const rawKey = (entry as { key?: unknown }).key;
    if (typeof rawKey !== "string" || !isRenderableTableColumn(rawKey)) continue;
    const key = rawKey as TableColumnKey;
    const width = (entry as { width?: unknown }).width;
    if (key === "title") {
      // Web's own config always leads with title; a blob that puts it later
      // still gets the pinned slot, and only the first one counts. Its WIDTH
      // is kept even though the phone pins the title column and never resizes
      // it: dropping it would make a mobile open-and-re-save stamp web's title
      // width back to web's own default, for web users too.
      if (pinnedTitle) continue;
      pinnedTitle = true;
      if (typeof width === "number" && Number.isFinite(width)) {
        widths.title = clampColumnWidth(width);
      }
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    if (typeof width === "number" && Number.isFinite(width)) {
      widths[key] = clampColumnWidth(width);
    }
  }
  if (seen.size === 0) {
    // Nothing beyond the pinned title survived. Two readings, both handled by
    // the same answer: "only title was ever visible" is a legitimate, if
    // stark, column set the table CAN render, while "every column this build
    // knows was dropped" means there is no preference to honour. Falling back
    // to the defaults is right for the second and merely unremarkable for the
    // first — a phone table showing one column is not a state web can produce
    // either (its title column is resizable, so a title-only view is rare).
    //
    // The width the blob carried for title is kept either way, so the
    // round-trip loss this guards against does not reappear on this path.
    const defaults = defaultTableColumns();
    return {
      tableColumns: pinnedTitle ? (["title"] as TableColumnKey[]) : defaults,
      tableColumnWidths: widths,
    };
  }
  // Order = display order, `title` pinned first (see rule 1).
  return {
    tableColumns: ["title", ...seen],
    tableColumnWidths: widths,
  };
}

/** A key this build can actually render a column for. `child_progress` is
 *  web-only (mobile's `Issue` has no child-progress field of its own — see
 *  `issue-table-columns.ts`), so it is NOT renderable here and drops. */
function isRenderableTableColumn(key: string): boolean {
  if (key.startsWith(PROPERTY_COLUMN_PREFIX)) {
    return key.length > PROPERTY_COLUMN_PREFIX.length;
  }
  return TABLE_SYSTEM_COLUMN_KEYS.has(key);
}

/**
 * Table grouping — `none` | `status` | `assignee` | `property:<id>`, default
 * `none` (`view-store.ts:306`). Same enum discipline as the rest of this
 * file, with the `property:` prefix handled as a shape rather than a fixed
 * member (the id is not knowable here).
 */
function sanitizeTableGrouping(raw: unknown): IssueTableGrouping {
  if (typeof raw !== "string") return "none";
  if (raw === "none" || raw === "status" || raw === "assignee") return raw;
  if (raw.startsWith(PROPERTY_COLUMN_PREFIX) && raw.length > PROPERTY_COLUMN_PREFIX.length) {
    return raw as IssueTableGrouping;
  }
  return "none";
}

/**
 * The custom-property ids a view's cards show, in the order it saved them.
 *
 * **Unknown ids are KEPT, unlike every other sanitize in this file.** The other
 * sanitizers drop values the store cannot represent (a stale enum member); here
 * the store CAN represent any string, and dropping is actively harmful in two
 * ways web does not suffer from:
 *
 *   - a definition missing from the CURRENT catalog is not necessarily deleted
 *     — the catalog is a separate query that may still be in flight, and
 *     archived definitions are excluded from the active list mobile's card
 *     reads. Web's store keeps the id and its board card simply renders nothing
 *     for it (`board-card.tsx:69-72` resolves against whatever catalog it has).
 *     Dropping here would make a mobile open-and-resave of a web view LOSE the
 *     chip permanently, even after the definition came back;
 *   - it preserves the round-trip contract the rest of this file states: what
 *     the view carried is what a re-save writes back.
 *
 * Rendering is where an unresolvable id is filtered out, per-issue and
 * per-render — `lib/card-properties.ts`.
 */
export function sanitizeCardPropertyIds(raw: unknown): string[] {
  return stringArray(raw).filter((id) => id.length > 0);
}

/** The eight card-property keys, in web's `CARD_PROPERTY_OPTIONS` order. */
const CARD_PROPERTY_KEYS: (keyof CardProperties)[] = [
  "priority",
  "description",
  "assignee",
  "startDate",
  "dueDate",
  "project",
  "labels",
  "childProgress",
];

/**
 * Per-key boolean sanitize of a view's `cardProperties` blob. Anything that
 * is not `false` reads as `true`: a missing key, a `null`, a string, a
 * non-object. Only an explicit `false` turns a field off, which is what makes
 * an OLDER view (saved before a key existed) keep the field visible rather
 * than silently hiding it.
 */
export function sanitizeCardProperties(raw: unknown): CardProperties {
  const source =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const out = {} as CardProperties;
  for (const key of CARD_PROPERTY_KEYS) {
    out[key] = source[key] !== false;
  }
  return out;
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
 *  every display default web writes (which now includes the canvas-shape
 *  dimensions: swimlane grouping, table columns + widths, table grouping).
 *  Structural so either surface can pass its own filter state object
 *  (workspace Issues and My Issues keep separate stores). */
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
  | "tableHierarchy"
  | "cardProperties"
  | "cardPropertyIds"
> & {
  swimlaneGrouping: SwimlaneGrouping;
  tableColumns: readonly TableColumnKey[];
  tableColumnWidths: TableColumnWidths;
  tableGrouping: IssueTableGrouping;
};

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
    wantDisplay.showSubIssues === slice.showSubIssues &&
    // Same reasoning as the card-property clause below: a view fixes the
    // table's nesting, so flipping it must light the "modified" dot.
    wantDisplay.tableHierarchy === slice.tableHierarchy &&
    // Card-property toggles are part of a saved view's display, so flipping
    // one must light the "modified" dot. Without this clause the dot would
    // stay dark and the user's change would be silently unsavable.
    sameCardProperties(wantDisplay.cardProperties, slice.cardProperties) &&
    // Same reason, second dimension: the custom-property selection is saved in
    // the view's display too, so adding / removing one is a modification.
    // Order matters here — the array IS the render order, so a reorder is a
    // real change (sameStrings compares positionally).
    sameStrings(wantDisplay.cardPropertyIds, slice.cardPropertyIds) &&
    // The canvas-shape dimensions are saved and restored too, so changing one
    // IS a modification. Leaving them out would light no dot and the user's
    // change would have no route into the view (the "re-save" affordance only
    // appears while the dot is on).
    sameCanvasShape(wantDisplay, slice, view.display)
  );
}

/** The three canvas-shape dimensions, compared as a saved view fixes them.
 *
 *  **A dimension the view does not CARRY is not compared.** Views saved before
 *  mobile wrote these keys out (every view created by a pre-0.6.96 build) do
 *  not fix a swimlane dimension or a column set, so the live surface may sit on
 *  anything without being "modified" — the same contract `showSubIssues` and
 *  `tableHierarchy` already follow for pre-key views. Without this, every
 *  older view would open with the modified dot permanently lit and the user
 *  would be told they had unsaved changes they never made.
 *
 *  Presence is read off the RAW display blob, not the sanitized patch: the
 *  patch fills every key with a default, which is exactly the information this
 *  needs to keep. */
function sameCanvasShape(
  want: IssueViewDisplayPatch,
  slice: Pick<
    IssueViewSnapshotSource,
    "swimlaneGrouping" | "tableColumns" | "tableColumnWidths" | "tableGrouping"
  >,
  raw: Record<string, unknown>,
): boolean {
  if (
    raw.swimlaneGrouping !== undefined &&
    want.swimlaneGrouping !== slice.swimlaneGrouping
  ) {
    return false;
  }
  if (
    raw.tableGrouping !== undefined &&
    want.tableGrouping !== slice.tableGrouping
  ) {
    return false;
  }
  // Column ORDER is a fact the user controls (web's `reorderTableColumn`), so
  // this is positional like `sameStrings` above.
  if (
    raw.tableColumns !== undefined &&
    !sameStrings(want.tableColumns as string[], slice.tableColumns as string[])
  ) {
    return false;
  }
  if (raw.tableColumns === undefined) return true;
  // Widths compare per key, order-independent: the object is a sparse
  // override bag, so key order carries no meaning. A column the user never
  // resized has no entry in either side.
  const wantKeys = Object.keys(want.tableColumnWidths);
  const currKeys = Object.keys(slice.tableColumnWidths);
  if (wantKeys.length !== currKeys.length) return false;
  return wantKeys.every((k) => {
    const wantWidth = want.tableColumnWidths[k as TableColumnKey];
    const currWidth = slice.tableColumnWidths[k as TableColumnKey];
    return wantWidth === currWidth;
  });
}

/** Same eight keys, same values — order-independent by construction. */
function sameCardProperties(a: CardProperties, b: CardProperties): boolean {
  return CARD_PROPERTY_KEYS.every((key) => a[key] === b[key]);
}
// ---------------------------------------------------------------------------
// "Is anything the user added on top of the open view?" (iteration 258)
// ---------------------------------------------------------------------------

/**
 * Whether a dimension's live selection holds anything the open view does not
 * already fix. Without a baseline every non-empty selection counts; with one,
 * values the view itself fixes do not.
 *
 * This is web's `delta()` inside `getActiveFilterCount`
 * (`issues-header.tsx:132-170`) — the predicate that decides both whether the
 * Reset entry is offered and (on the phone) whether a dimension row's
 * "fixed by this view" state applies.
 */
function exceedsBaseline(
  values: readonly string[],
  fixed: ReadonlySet<string> | undefined,
): boolean {
  if (values.length === 0) return false;
  if (!fixed) return true;
  return values.some((v) => !fixed.has(v));
}

/**
 * The set of filter dimensions the user has changed BEYOND the open saved
 * view — web's `getActiveFilterCount(...) > 0`, stated as the set so a caller
 * can also ask "is THIS dimension changed".
 *
 * The distinction is what makes Reset mean the right thing: inside a view the
 * view's own conditions are not "active filtering", so a Reset that treated
 * them as such either offered itself when nothing was added, or (the defect
 * this replaces) wiped the view's definition when something was.
 *
 * `workingOnly` and `dateFilter` are user layers no view carries
 * (`issue-filter-slice.ts:282-286`), so they always count on their own.
 */
export function activeFilterDimensions(
  state: IssueFilterDims & { workingOnly?: boolean },
  baseline: IssueViewBaseline | null,
): ActiveFilterDimension[] {
  const out: ActiveFilterDimension[] = [];
  if (exceedsBaseline(state.statusFilters, baseline?.status)) out.push("status");
  if (exceedsBaseline(state.priorityFilters, baseline?.priority)) {
    out.push("priority");
  }
  if (
    exceedsBaseline(
      state.assigneeFilters.map(actorBaselineKey),
      baseline?.assignee,
    ) ||
    (state.includeNoAssignee && !(baseline?.includeNoAssignee ?? false))
  ) {
    out.push("assignee");
  }
  if (
    exceedsBaseline(
      state.creatorFilters.map(actorBaselineKey),
      baseline?.creator,
    )
  ) {
    out.push("creator");
  }
  if (
    exceedsBaseline(state.projectFilters, baseline?.project) ||
    (state.includeNoProject && !(baseline?.includeNoProject ?? false))
  ) {
    out.push("project");
  }
  if (exceedsBaseline(state.labelFilters, baseline?.label)) out.push("label");
  for (const [id, selected] of Object.entries(state.propertyFilters)) {
    if (exceedsBaseline(selected, baseline?.property.get(id))) {
      out.push(`property:${id}` as FilterDimension);
    }
  }
  if (state.dateFilter) out.push("date");
  if (state.workingOnly) out.push("workingOnly");
  return out;
}

/**
 * The snapshot a Reset must leave the store in.
 *
 * Web's rule (`issues-header.tsx:1513-1527`): inside a saved view, reset
 * returns to the VIEW's conditions; outside one it clears everything. The
 * date window is handled separately by the caller because it is not part of
 * `IssueFilterSnapshot` — web calls `onDateFilterChange?.(null)` right after
 * the same branch. `workingOnly` is likewise outside the snapshot and is left
 * to the caller for the same reason.
 *
 * Returned as a discriminated result rather than "a snapshot or null" so a
 * caller cannot accidentally treat a null view as "nothing to do".
 */
/**
 * A dimension the user can have changed beyond an open view. Extends the
 * store's `FilterDimension` (which the chip bar clears) with `workingOnly` —
 * a quick filter that has no chip and therefore no store-level dimension,
 * but which a Reset must still turn off.
 */
export type ActiveFilterDimension = FilterDimension | "workingOnly";

export type FilterResetPlan =
  | { kind: "to-view"; snapshot: IssueFilterSnapshot }
  | { kind: "clear" };

export function planFilterReset(
  baseline: IssueViewBaseline | null,
): FilterResetPlan {
  return baseline
    ? { kind: "to-view", snapshot: baseline.raw }
    : { kind: "clear" };
}

/** The store actions one Reset touches. Structural, so the callers' three
 *  concrete zustand stores all satisfy it without a cast. */
export interface FilterResetActions {
  resetFiltersTo: (snapshot: IssueFilterSnapshot) => void;
  clearFilters: () => void;
  setDateFilter: (value: IssueDateFilterValue | null) => void;
  toggleWorkingOnly: () => void;
}

/**
 * Perform a Reset in full — the ONE place the semantics live.
 *
 * Web's handler (`issues-header.tsx:1513-1527`) is a branch plus a trailing
 * `onDateFilterChange?.(null)`; the date is outside the snapshot because
 * views never carry one, and mobile's `workingOnly` quick filter is outside
 * it for a third reason (`issue-filter-slice.ts:143-152`: it is deliberately
 * neither persisted nor saved, and `clearFilters` is the only thing that
 * turns it off). Both have to be undone on EVERY path, which is why they are
 * written here once rather than repeated at the call site where one branch
 * could quietly lose them.
 *
 * `state` is read only for `workingOnly` — the store exposes a toggle, not a
 * setter, so "turn it off" has to be conditional to stay idempotent.
 */
export function applyFilterReset(
  state: { workingOnly: boolean },
  baseline: IssueViewBaseline | null,
  actions: FilterResetActions,
): void {
  const plan = planFilterReset(baseline);
  if (plan.kind === "to-view") actions.resetFiltersTo(plan.snapshot);
  else actions.clearFilters();
  actions.setDateFilter(null);
  if (state.workingOnly) actions.toggleWorkingOnly();
}
