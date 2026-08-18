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
  /** Toggle one column's visibility. `title` is permanent — toggling it is
   *  a no-op (web `toggleTableColumn`). */
  toggleTableColumn: (column: TableColumnKey) => void;
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
): Pick<TableColumnsSlice, "toggleTableColumn"> {
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
  };
}