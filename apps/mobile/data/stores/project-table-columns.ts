/**
 * Projects compact-table column state (iteration-135). The projects list is
 * web's one dual-view surface (`viewMode` compact/comfortable,
 * `packages/core/projects/stores/view-store.ts:13`), and this is the mobile
 * port of the compact view's column configuration.
 *
 * Deliberately its OWN store instance, not a slice of the issue
 * `TableColumnsSlice` (`issue-table-columns.ts`): a column hidden on the
 * projects list must not hide the same-named issue column, and the two
 * surfaces do not even share a key space (projects have no `title` /
 * `assignee` / dates). The *model* is reused, though — an ordered visible
 * array (order = display order, presence = visibility) plus a sparse
 * width-override bag, and the same min/max clamp — so the two tables behave
 * identically under the same gestures.
 *
 * Two deliberate divergences from web's `hiddenColumns` model:
 *
 *  - Web stores the HIDDEN set; we store the VISIBLE order. Web's compact
 *    table has a fixed column order, so it has nothing to persist but
 *    visibility. Mobile reuses iteration-134's reorderable columns, which
 *    needs an order, and an ordered visible array carries both facts in one
 *    field (same choice `issue-table-columns.ts` made).
 *  - Web's `name` + `status` are the non-hideable core (`view-store.ts:46`);
 *    they are pinned in the table and therefore absent from this array, not
 *    toggleable entries. Default visibility still matches web exactly:
 *    `PROJECT_DEFAULT_HIDDEN_COLUMNS = ["issues"]` (`view-store.ts:52`).
 */
import { create } from "zustand";
import { clampColumnWidth } from "./issue-table-columns";
import type { ProjectSortField } from "@/lib/filter-projects";

/** The hideable / reorderable compact-table columns. Matches web's
 *  `ProjectColumnKey` (`view-store.ts:48`) exactly. */
export type ProjectTableColumnKey =
  | "priority"
  | "progress"
  | "lead"
  | "issues"
  | "created";

export const PROJECT_TABLE_COLUMN_KEYS: readonly ProjectTableColumnKey[] = [
  "priority",
  "progress",
  "lead",
  "issues",
  "created",
];

export function isProjectTableColumnKey(
  value: string,
): value is ProjectTableColumnKey {
  return (PROJECT_TABLE_COLUMN_KEYS as readonly string[]).includes(value);
}

/** Per-column width overrides. Sparse on purpose — an absent key means "still
 *  at the default", so a later default change reaches every untouched column
 *  (same contract as the issue table's `TableColumnWidths`). */
export type ProjectTableColumnWidths = Partial<
  Record<ProjectTableColumnKey, number>
>;

/** Web's `COLUMN_WIDTHS` for the compact table
 *  (`projects-page.tsx:147`), unchanged — the phone renders the same fields
 *  with the same padding, so the desktop widths are the right starting point
 *  and the user can drag from there. */
export const DEFAULT_PROJECT_COLUMN_WIDTHS: Record<
  ProjectTableColumnKey,
  number
> = {
  priority: 116,
  progress: 88,
  lead: 132,
  issues: 80,
  created: 104,
};

export interface ProjectTableColumnDefinition {
  key: ProjectTableColumnKey;
  /** i18n key for the header and the column-menu row. */
  labelKey: string;
  /** The project sort field this header drives, when it has one. */
  sortField?: ProjectSortField;
}

/** Catalog in web's render order (`projects-page.tsx:686` COLUMN_KEYS), which
 *  is also the order a newly-shown column appends against. `priority` /
 *  `progress` / `created` are sortable because `PROJECT_SORT_FIELDS`
 *  (`lib/filter-projects.ts`) has them; `lead` and `issues` have no project
 *  sort dimension on web either, so their headers stay inert. */
export const PROJECT_TABLE_COLUMNS: readonly ProjectTableColumnDefinition[] = [
  {
    key: "priority",
    labelKey: "projects.filterPriority",
    sortField: "priority",
  },
  {
    key: "progress",
    labelKey: "projects.sortProgress",
    sortField: "progress",
  },
  { key: "lead", labelKey: "projects.filterLead" },
  { key: "issues", labelKey: "projects.column.issues" },
  { key: "created", labelKey: "projects.sortCreated", sortField: "created" },
];

/** Web's default: everything visible except the issue count
 *  (`PROJECT_DEFAULT_HIDDEN_COLUMNS`), in catalog order. */
export const DEFAULT_PROJECT_TABLE_COLUMNS: readonly ProjectTableColumnKey[] = [
  "priority",
  "progress",
  "lead",
  "created",
];

export function defaultProjectTableColumns(): ProjectTableColumnKey[] {
  return [...DEFAULT_PROJECT_TABLE_COLUMNS];
}

/** The width a column starts at, before any user override. */
export function defaultProjectColumnWidth(
  column: ProjectTableColumnKey,
): number {
  return DEFAULT_PROJECT_COLUMN_WIDTHS[column];
}

/** The width to lay a column out at: the override when there is one, else the
 *  default — clamped either way, so a stale persisted value can never produce
 *  an unusable column. */
export function columnWidthOf(
  column: ProjectTableColumnKey,
  widths: ProjectTableColumnWidths,
): number {
  const override = widths[column];
  if (override == null) return defaultProjectColumnWidth(column);
  return clampColumnWidth(override);
}

/** Width during a resize drag: where the gesture started plus the distance
 *  travelled, clamped so the live preview equals what a release commits. */
export function nextProjectColumnWidth(startWidth: number, dx: number): number {
  return clampColumnWidth(startWidth + dx);
}

/**
 * Which way a column can move, given its slot and how many columns there are.
 * Mirrors `reorderProjectTableColumn`'s guards so a menu built from this can
 * never offer a control the store would refuse. Unlike the issue table there
 * is no pinned slot inside the array — `name`/`status` live outside it — so
 * slot 0 is movable (and merely cannot move further left).
 */
export function projectColumnMoveAvailability(
  position: number,
  count: number,
): { left: boolean; right: boolean } {
  return { left: position > 0, right: position >= 0 && position < count - 1 };
}

/** Sort field bound to a header-tappable column, if the column has one. */
export function projectSortFieldForColumn(
  column: ProjectTableColumnKey,
): ProjectSortField | undefined {
  return PROJECT_TABLE_COLUMNS.find((c) => c.key === column)?.sortField;
}

export interface ProjectTableColumnsState {
  /** Ordered visible columns. Core columns (`name` + `status`) are pinned in
   *  the table and deliberately absent — they can never be hidden. */
  projectTableColumns: ProjectTableColumnKey[];
  /** Width overrides for the columns the user resized. */
  projectTableColumnWidths: ProjectTableColumnWidths;
  /** Show a hidden column (appended, so order equals the order the user built)
   *  or hide a visible one. */
  toggleProjectTableColumn: (column: ProjectTableColumnKey) => void;
  /** Pin a width after a resize drag. Setting it back to the default clears
   *  the override rather than freezing today's default forever. */
  setProjectTableColumnWidth: (
    column: ProjectTableColumnKey,
    width: number,
  ) => void;
  /** Move a visible column one slot towards the front (-1) or the back (+1).
   *  No-op on a hidden column and past either end of the array. */
  reorderProjectTableColumn: (
    column: ProjectTableColumnKey,
    delta: -1 | 1,
  ) => void;
  /** Restore the default column set, order and widths. */
  resetProjectTableColumns: () => void;
}

/**
 * Session-scoped like the other mobile project view state
 * (`useProjectMobileViewStore` in `projects-screen.tsx`) — no persist
 * middleware, matching `issues-view-store` and the phone's general rule that
 * a teammate re-sharing a filter should not be fought by a stale local view.
 */
export const useProjectTableColumnsStore = create<ProjectTableColumnsState>()(
  (set) => ({
    projectTableColumns: defaultProjectTableColumns(),
    projectTableColumnWidths: {},

    toggleProjectTableColumn: (column) =>
      set((state) => {
        const current = state.projectTableColumns;
        if (current.includes(column)) {
          return { projectTableColumns: current.filter((c) => c !== column) };
        }
        return { projectTableColumns: [...current, column] };
      }),

    setProjectTableColumnWidth: (column, width) =>
      set((state) => {
        const widths = { ...state.projectTableColumnWidths };
        const next = clampColumnWidth(width);
        if (next === defaultProjectColumnWidth(column)) delete widths[column];
        else widths[column] = next;
        return { projectTableColumnWidths: widths };
      }),

    reorderProjectTableColumn: (column, delta) =>
      set((state) => {
        const current = state.projectTableColumns;
        const from = current.indexOf(column);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= current.length) return state;
        const next = [...current];
        next[from] = next[to];
        next[to] = column;
        return { projectTableColumns: next };
      }),

    resetProjectTableColumns: () =>
      set(() => ({
        projectTableColumns: defaultProjectTableColumns(),
        projectTableColumnWidths: {},
      })),
  }),
);
