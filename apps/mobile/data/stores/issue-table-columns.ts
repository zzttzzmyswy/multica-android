/**
 * Table-view column state slice (iteration-69). Mobile surface of web's
 * `packages/core/issues/stores/view-store.ts` table-columns slice:
 * the visible columns of the IssueWorkbench table view as an ordered array
 * (`tableColumns`), toggled by key, with `title` permanently forced (web's
 * `toggleTableColumn` semantics — the array's first entry is always title).
 *
 * Column identity matches web: system columns use the bare `TableSystemColumn`
 * key, custom-property columns use `property:<definitionId>`
 * (`PROPERTY_COLUMN_PREFIX` — web's `property:${string}`). Order = display
 * order; presence in the array = visibility. No hidden-columns bag.
 *
 * The slice factory mirrors `createIssueFilterActions` in
 * `issue-filter-slice.ts`: each of the three view stores
 * (`issues-view-store` / `my-issues-view-store` / `project-issues-view-store`)
 * owns its own instance so column visibility is isolated per surface.
 *
 * `child_progress` is intentionally absent from the mobile system columns:
 * it is a computed workspace-level aggregation on web and does not exist on
 * the shared `Issue` schema (`packages/core/types/issue.ts`).
 */
import type {
  IssueSortDirection,
  IssueSortField,
} from "./issue-filter-slice";

/** Write-only system columns the table can render. Excludes
 *  `child_progress` (web has it; the mobile Issue type does not). */
export type TableSystemColumn =
  | "title"
  | "identifier"
  | "status"
  | "priority"
  | "assignee"
  | "labels"
  | "project"
  | "start_date"
  | "due_date"
  | "created_at"
  | "updated_at"
  | "creator";

/** A visible column key — a system column or a custom-property column. */
export type TableColumnKey = TableSystemColumn | `property:${string}`;

/** Per-column width overrides, keyed by column key. Sparse on purpose: an
 *  absent key means "still at the default", so a system default can change
 *  without stranding every column the user never touched. */
export type TableColumnWidths = Partial<Record<TableColumnKey, number>>;

/** Floor / ceiling for a dragged column. The floor keeps a header legible
 *  (and its resize handle reachable); the ceiling stops one column from
 *  pushing every other column out of the horizontal scroller. */
export const COLUMN_WIDTH_MIN = 64;
export const COLUMN_WIDTH_MAX = 360;

/** Default widths for the system columns the phone renders. Mirrors the
 *  `COLUMN_WIDTHS` table the table view carried before iteration 134 — the
 *  values moved here so the slice, the table and its tests share one source.
 *  `title` is absent: the title column is pinned, not part of the scroller. */
export const DEFAULT_COLUMN_WIDTHS: Record<
  Exclude<TableSystemColumn, "title">,
  number
> = {
  identifier: 84,
  status: 104,
  priority: 88,
  assignee: 132,
  labels: 140,
  project: 132,
  start_date: 100,
  due_date: 88,
  created_at: 104,
  updated_at: 104,
  creator: 132,
};

/** Width for a property (non-system) column and for any unknown key. */
export const PROPERTY_COLUMN_WIDTH = 132;

/** Shared with the projects compact table (`project-table-columns.ts`), which
 *  reuses the same floor / ceiling rather than inventing its own. */
export function clampColumnWidth(width: number): number {
  return Math.min(COLUMN_WIDTH_MAX, Math.max(COLUMN_WIDTH_MIN, Math.round(width)));
}

/** The default width a column starts at (before any user override). */
export function defaultColumnWidth(column: TableColumnKey): number {
  // `title` is pinned rather than scrolled, so it never reaches the sizing
  // path; it shares the property-column default because there is no other
  // sensible number for it.
  if (column === "title" || column.startsWith(PROPERTY_COLUMN_PREFIX)) {
    return PROPERTY_COLUMN_WIDTH;
  }
  return DEFAULT_COLUMN_WIDTHS[column as Exclude<TableSystemColumn, "title">];
}

/**
 * The width to lay a column out at: the user's override when there is one,
 * otherwise the default — clamped either way, so a value persisted by an older
 * build (or a future default change) can never produce an unusable column.
 */
export function columnWidthOf(
  column: TableColumnKey,
  widths: TableColumnWidths,
): number {
  const override = widths[column];
  if (override == null) return defaultColumnWidth(column);
  return clampColumnWidth(override);
}

/** Width during a drag: the width the gesture started from plus the distance
 *  travelled, clamped so the live preview equals what a release will commit. */
export function nextColumnWidth(startWidth: number, dx: number): number {
  return clampColumnWidth(startWidth + dx);
}

/**
 * Which way a column can move, given its slot in the display order and how
 * many columns there are. Mirrors `reorderTableColumn`'s guards exactly, so a
 * menu built from this can never offer a control the store would refuse:
 * slot 0 is the pinned `title` (not movable at all), and the leftmost slot a
 * scrolled column can reach is 1.
 */
export function columnMoveAvailability(
  position: number,
  count: number,
): { left: boolean; right: boolean } {
  return {
    left: position > 1,
    right: position >= 1 && position < count - 1,
  };
}

export const PROPERTY_COLUMN_PREFIX = "property:";

/** Strip the `property:` prefix off a property column key. */
export function propertyIdFromTableColumn(
  column: TableColumnKey,
): string | null {
  return column.startsWith(PROPERTY_COLUMN_PREFIX)
    ? column.slice(PROPERTY_COLUMN_PREFIX.length)
    : null;
}

/** System-column catalog in display order. `sortField` marks the columns
 *  whose header tap drives the shared sort store (mirrors web
 *  `SORTABLE_COLUMNS`: title/status/priority/dates/timestamps; identifier /
 *  assignee / labels / project / creator are not sortable on the header). */
export interface TableColumnDefinition {
  key: TableSystemColumn;
  /** i18n key for the header / column-menu label. */
  labelKey: string;
  sortField?: IssueSortField;
}

export const TABLE_SYSTEM_COLUMNS: readonly TableColumnDefinition[] = [
  { key: "title", labelKey: "table.column.title", sortField: "title" },
  { key: "identifier", labelKey: "table.column.identifier" },
  { key: "status", labelKey: "table.column.status", sortField: "status" },
  { key: "priority", labelKey: "table.column.priority", sortField: "priority" },
  { key: "assignee", labelKey: "table.column.assignee" },
  { key: "labels", labelKey: "table.column.labels" },
  { key: "project", labelKey: "table.column.project" },
  {
    key: "start_date",
    labelKey: "table.column.startDate",
    sortField: "start_date",
  },
  {
    key: "due_date",
    labelKey: "table.column.dueDate",
    sortField: "due_date",
  },
  {
    key: "created_at",
    labelKey: "table.column.createdAt",
    sortField: "created_at",
  },
  {
    key: "updated_at",
    labelKey: "table.column.updatedAt",
    sortField: "updated_at",
  },
  { key: "creator", labelKey: "table.column.creator" },
];

/** Mobile default columns — a compact phone subset of web's
 *  `DEFAULT_TABLE_COLUMNS` (title/status/priority/assignee/due_date/labels):
 *  title + identifier + the four columns that fit a narrow screen. */
export const DEFAULT_TABLE_COLUMNS: readonly TableColumnKey[] = [
  "title",
  "identifier",
  "status",
  "priority",
  "assignee",
  "due_date",
];

export function defaultTableColumns(): TableColumnKey[] {
  return [...DEFAULT_TABLE_COLUMNS];
}

/** Fresh (empty) width-override bag — every column still at its default. */
export function defaultTableColumnWidths(): TableColumnWidths {
  return {};
}

/** Sort field bound to a header-tappable system column, if any. */
export function sortFieldForTableColumn(
  column: TableColumnDefinition | undefined,
): IssueSortField | undefined {
  return column?.sortField;
}

/**
 * Header-tap sort transition, mirroring web's table header behavior: tapping
 * a NEW column applies the default ascending direction; tapping the ALREADY
 * active column flips direction (web exposes the two directions as explicit
 * menu options; the mobile tap-to-cycle is the touch adaptation of the same
 * two targets).
 */
export function nextTableSort(
  currentField: IssueSortField,
  currentDirection: IssueSortDirection,
  targetField: IssueSortField,
): { field: IssueSortField; direction: IssueSortDirection } {
  if (currentField === targetField) {
    return {
      field: targetField,
      direction: currentDirection === "asc" ? "desc" : "asc",
    };
  }
  return { field: targetField, direction: "asc" };
}

export interface TableColumnsSlice {
  /** Ordered visible columns; `[0]` is always "title". */
  tableColumns: TableColumnKey[];
  /** Width overrides for the columns the user resized (iteration 134). */
  tableColumnWidths: TableColumnWidths;
  /** Toggle one column's visibility. `title` is permanent — toggling it is
   *  a no-op (web `toggleTableColumn`). */
  toggleTableColumn: (column: TableColumnKey) => void;
  /** Pin a column's width after a resize drag (web `setTableColumnWidth`).
   *  Setting it back to the default clears the override. */
  setTableColumnWidth: (column: TableColumnKey, width: number) => void;
  /** Move a visible column one slot towards the front (-1) or the back (+1)
   *  (web `reorderTableColumn`). No-op on `title`, on a hidden column, and
   *  past either end of the array. */
  reorderTableColumn: (column: TableColumnKey, delta: -1 | 1) => void;
  /** Restore the default column set, order and widths. */
  resetTableColumns: () => void;
}

/**
 * Action factory shared by the three view stores. `set` is the caller's
 * zustand `setState`, generic over the store state so it works for each
 * store's extended state (each extends `IssueFilterSlice` with scope/view +
 * this slice). Actions only touch the table-columns fields, so a
 * `Partial<T>` update is always safe.
 */
export function createTableColumnActions<T extends TableColumnsSlice>(
  set: (
    partial:
      | Partial<TableColumnsSlice>
      | ((state: TableColumnsSlice) => Partial<TableColumnsSlice>),
  ) => void,
): Pick<
  TableColumnsSlice,
  | "toggleTableColumn"
  | "setTableColumnWidth"
  | "reorderTableColumn"
  | "resetTableColumns"
> {
  return {
    toggleTableColumn: (column) =>
      set((state) => {
        // title is permanent (web returns the state unchanged on title).
        if (column === "title") return state;
        const current = state.tableColumns;
        if (current.includes(column)) {
          return { tableColumns: current.filter((c) => c !== column) };
        }
        // Appended so the display order equals the order the user built it.
        return { tableColumns: [...current, column] };
      }),

    setTableColumnWidth: (column, width) =>
      set((state) => {
        const widths = { ...state.tableColumnWidths };
        const next = clampColumnWidth(width);
        // Back at the default: forget the override rather than pinning the
        // current default forever (a later default change should reach it).
        if (next === defaultColumnWidth(column)) delete widths[column];
        else widths[column] = next;
        return { tableColumnWidths: widths };
      }),

    reorderTableColumn: (column, delta) =>
      set((state) => {
        const current = state.tableColumns;
        // title stays first — it is pinned, and swapping it with its
        // neighbour would push the pinned column out of the scroller it is
        // not part of (web pins it the same way).
        if (column === "title") return state;
        const from = current.indexOf(column);
        const to = from + delta;
        if (from < 0 || to < 1 || to >= current.length) return state;
        const next = [...current];
        next[from] = next[to];
        next[to] = column;
        return { tableColumns: next };
      }),

    resetTableColumns: () =>
      set(() => ({
        tableColumns: defaultTableColumns(),
        tableColumnWidths: defaultTableColumnWidths(),
      })),
  };
}