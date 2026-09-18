import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_PROJECT_COLUMN_WIDTHS,
  DEFAULT_PROJECT_TABLE_COLUMNS,
  PROJECT_TABLE_COLUMNS,
  columnWidthOf,
  defaultProjectColumnWidth,
  isProjectTableColumnKey,
  projectColumnMoveAvailability,
  projectSortFieldForColumn,
  useProjectTableColumnsStore,
} from "./project-table-columns";

describe("project table columns (iteration-135)", () => {
  beforeEach(() => {
    useProjectTableColumnsStore.getState().resetProjectTableColumns();
  });

  it("starts from web's default visible set, in web's render order", () => {
    // packages/core/projects/stores/view-store.ts:52 hides `issues` by
    // default; the rest show, ordered as web renders them (:686 COLUMN_KEYS).
    expect(DEFAULT_PROJECT_TABLE_COLUMNS).toEqual([
      "priority",
      "progress",
      "lead",
      "created",
    ]);
    expect(useProjectTableColumnsStore.getState().projectTableColumns).toEqual([
      "priority",
      "progress",
      "lead",
      "created",
    ]);
    // Catalog order is the fixed display order new columns append against.
    expect(PROJECT_TABLE_COLUMNS.map((c) => c.key)).toEqual([
      "priority",
      "progress",
      "lead",
      "issues",
      "created",
    ]);
  });

  it("toggles a hidden column on by appending it, and off by removing it", () => {
    const { toggleProjectTableColumn } = useProjectTableColumnsStore.getState();
    toggleProjectTableColumn("issues");
    expect(useProjectTableColumnsStore.getState().projectTableColumns).toEqual([
      "priority",
      "progress",
      "lead",
      "created",
      "issues",
    ]);
    toggleProjectTableColumn("priority");
    expect(useProjectTableColumnsStore.getState().projectTableColumns).toEqual([
      "progress",
      "lead",
      "created",
      "issues",
    ]);
  });

  it("reorders within the array and refuses to move past either end", () => {
    const { reorderProjectTableColumn } =
      useProjectTableColumnsStore.getState();
    reorderProjectTableColumn("progress", -1);
    expect(useProjectTableColumnsStore.getState().projectTableColumns).toEqual([
      "progress",
      "priority",
      "lead",
      "created",
    ]);
    // Already first — a left move is a no-op rather than a wrap-around.
    reorderProjectTableColumn("progress", -1);
    expect(useProjectTableColumnsStore.getState().projectTableColumns).toEqual([
      "progress",
      "priority",
      "lead",
      "created",
    ]);
    reorderProjectTableColumn("progress", 1);
    expect(useProjectTableColumnsStore.getState().projectTableColumns).toEqual([
      "priority",
      "progress",
      "lead",
      "created",
    ]);
    // Last slot — right is a no-op.
    reorderProjectTableColumn("created", 1);
    expect(useProjectTableColumnsStore.getState().projectTableColumns).toEqual([
      "priority",
      "progress",
      "lead",
      "created",
    ]);
  });

  it("ignores a reorder for a hidden column", () => {
    const { reorderProjectTableColumn } =
      useProjectTableColumnsStore.getState();
    reorderProjectTableColumn("issues", -1);
    expect(useProjectTableColumnsStore.getState().projectTableColumns).toEqual([
      "priority",
      "progress",
      "lead",
      "created",
    ]);
  });

  it("keeps widths sparse: back at the default clears the override", () => {
    const { setProjectTableColumnWidth } =
      useProjectTableColumnsStore.getState();
    setProjectTableColumnWidth("lead", 200);
    expect(useProjectTableColumnsStore.getState().projectTableColumnWidths).toEqual(
      { lead: 200 },
    );
    setProjectTableColumnWidth("lead", DEFAULT_PROJECT_COLUMN_WIDTHS.lead);
    expect(useProjectTableColumnsStore.getState().projectTableColumnWidths).toEqual(
      {},
    );
  });

  it("clamps a width to the shared floor / ceiling", () => {
    const { setProjectTableColumnWidth } =
      useProjectTableColumnsStore.getState();
    setProjectTableColumnWidth("progress", 4);
    expect(columnWidthOf("progress", useProjectTableColumnsStore.getState().projectTableColumnWidths)).toBe(64);
    setProjectTableColumnWidth("progress", 9999);
    expect(columnWidthOf("progress", useProjectTableColumnsStore.getState().projectTableColumnWidths)).toBe(360);
  });

  it("falls back to the default width for a column with no override", () => {
    for (const key of ["priority", "progress", "lead", "issues", "created"] as const) {
      expect(defaultProjectColumnWidth(key)).toBe(DEFAULT_PROJECT_COLUMN_WIDTHS[key]);
    }
  });

  it("offers a move only where the store would accept one", () => {
    expect(projectColumnMoveAvailability(0, 4)).toEqual({ left: false, right: true });
    expect(projectColumnMoveAvailability(2, 4)).toEqual({ left: true, right: true });
    expect(projectColumnMoveAvailability(3, 4)).toEqual({ left: true, right: false });
    // A single visible column can move nowhere.
    expect(projectColumnMoveAvailability(0, 1)).toEqual({ left: false, right: false });
  });

  it("resets both order and widths", () => {
    const s = useProjectTableColumnsStore.getState();
    s.toggleProjectTableColumn("issues");
    s.setProjectTableColumnWidth("lead", 250);
    s.resetProjectTableColumns();
    const after = useProjectTableColumnsStore.getState();
    expect(after.projectTableColumns).toEqual([...DEFAULT_PROJECT_TABLE_COLUMNS]);
    expect(after.projectTableColumnWidths).toEqual({});
  });

  it("maps the three sortable project columns onto the shared sort store", () => {
    // Priority / progress / created drive the existing project sort; lead and
    // issues have no project sort dimension (lib/filter-projects.ts
    // PROJECT_SORT_FIELDS), so their headers must not offer one.
    expect(projectSortFieldForColumn("priority")).toBe("priority");
    expect(projectSortFieldForColumn("progress")).toBe("progress");
    expect(projectSortFieldForColumn("created")).toBe("created");
    expect(projectSortFieldForColumn("lead")).toBeUndefined();
    expect(projectSortFieldForColumn("issues")).toBeUndefined();
  });

  it("recognises only the five real project column keys", () => {
    expect(isProjectTableColumnKey("priority")).toBe(true);
    expect(isProjectTableColumnKey("created")).toBe(true);
    expect(isProjectTableColumnKey("title")).toBe(false);
    expect(isProjectTableColumnKey("status")).toBe(false);
  });
});
