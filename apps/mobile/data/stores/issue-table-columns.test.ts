/**
 * Table-view column state slice (MYS-440). Semantics mirror web's
 * `toggleTableColumn` (packages/core/issues/stores/view-store.ts):
 * `tableColumns` is an ordered array; presence = visible; order = display
 * order; `title` is permanent (toggling it is a no-op) and always first.
 * Each surface store owns its own instance, so column visibility is
 * isolated per surface.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createStore } from "zustand/vanilla";
import {
  createTableColumnActions,
  DEFAULT_TABLE_COLUMNS,
  defaultTableColumns,
  nextTableSort,
  PROPERTY_COLUMN_PREFIX,
  propertyIdFromTableColumn,
  sortFieldForTableColumn,
  TABLE_SYSTEM_COLUMNS,
  type TableColumnKey,
  type TableColumnsSlice,
} from "./issue-table-columns";
import { useIssuesViewStore } from "./issues-view-store";
import { useProjectIssuesViewStore } from "./project-issues-view-store";
import { sanitizeViewDisplay } from "./issue-view-codec";

/** Minimal zustand store carrying exactly the table-columns slice. */
function makeStore() {
  return createStore<TableColumnsSlice>((set) => ({
    tableColumns: defaultTableColumns(),
    ...createTableColumnActions(set),
  }));
}

describe("default table columns", () => {
  it("defaults to the compact mobile subset with title first", () => {
    expect(DEFAULT_TABLE_COLUMNS[0]).toBe("title");
    expect(DEFAULT_TABLE_COLUMNS).toEqual([
      "title",
      "identifier",
      "status",
      "priority",
      "assignee",
      "due_date",
    ]);
    expect(defaultTableColumns()).toEqual([...DEFAULT_TABLE_COLUMNS]);
  });

  it("system columns exclude child_progress (absent from the Issue type)", () => {
    const keys = TABLE_SYSTEM_COLUMNS.map((c) => c.key);
    expect(keys).not.toContain("child_progress");
    expect(keys).toContain("title");
    expect(keys).toContain("creator");
  });

  it("only the seven header-sortable columns carry a sortField", () => {
    const sortable = TABLE_SYSTEM_COLUMNS.filter((c) => c.sortField);
    expect(sortable.map((c) => c.key)).toEqual([
      "title",
      "status",
      "priority",
      "start_date",
      "due_date",
      "created_at",
      "updated_at",
    ]);
    expect(sortFieldForTableColumn(undefined)).toBeUndefined();
  });
});

describe("toggleTableColumn", () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    store = makeStore();
  });

  it("toggles a column's visibility in place", () => {
    const state = store.getState();
    expect(state.tableColumns).toContain("status");
    state.toggleTableColumn("status");
    expect(store.getState().tableColumns).not.toContain("status");
    store.getState().toggleTableColumn("status");
    expect(store.getState().tableColumns).toContain("status");
  });

  it("appends new columns so display order matches build order", () => {
    const state = store.getState();
    const before = state.tableColumns;
    state.toggleTableColumn("labels");
    const after = store.getState().tableColumns;
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after[after.length - 1]).toBe("labels");
  });

  it("title is permanent — toggling it is a no-op", () => {
    const state = store.getState();
    state.toggleTableColumn("title");
    expect(store.getState().tableColumns[0]).toBe("title");
    expect(store.getState().tableColumns).toEqual(DEFAULT_TABLE_COLUMNS);
  });

  it("supports property columns via the property: prefix", () => {
    const state = store.getState();
    state.toggleTableColumn("property:def-1" as TableColumnKey);
    expect(store.getState().tableColumns).toContain("property:def-1");
    state.toggleTableColumn("property:def-1" as TableColumnKey);
    expect(store.getState().tableColumns).not.toContain("property:def-1");
  });
});

describe("property column key helpers", () => {
  it("round-trips property ids through the prefix", () => {
    expect(propertyIdFromTableColumn("property:def-1")).toBe("def-1");
    expect(propertyIdFromTableColumn("status")).toBeNull();
    expect(PROPERTY_COLUMN_PREFIX).toBe("property:");
  });
});

describe("nextTableSort (header-tap cycle)", () => {
  it("activates a fresh column in ascending order", () => {
    expect(nextTableSort("position", "asc", "priority")).toEqual({
      field: "priority",
      direction: "asc",
    });
  });

  it("flips direction when the active column is tapped again", () => {
    expect(nextTableSort("priority", "asc", "priority")).toEqual({
      field: "priority",
      direction: "desc",
    });
    expect(nextTableSort("priority", "desc", "priority")).toEqual({
      field: "priority",
      direction: "asc",
    });
  });

  it("moving to another column resets to ascending", () => {
    expect(nextTableSort("due_date", "desc", "status")).toEqual({
      field: "status",
      direction: "asc",
    });
  });
});

describe("surface stores own isolated tableColumns", () => {
  beforeEach(() => {
    useIssuesViewStore.setState({
      tableColumns: defaultTableColumns(),
      view: "list",
    });
    useProjectIssuesViewStore.setState({
      tableColumns: defaultTableColumns(),
      view: "list",
    });
  });

  it("toggling on one store does not leak to the other", () => {
    useIssuesViewStore.getState().toggleTableColumn("labels");
    expect(useIssuesViewStore.getState().tableColumns).toContain("labels");
    expect(useProjectIssuesViewStore.getState().tableColumns).not.toContain(
      "labels",
    );
  });

  it("accepts the table view mode", () => {
    useIssuesViewStore.getState().setView("table");
    expect(useIssuesViewStore.getState().view).toBe("table");
    useIssuesViewStore.getState().setView("list");
    expect(useIssuesViewStore.getState().view).toBe("list");
  });

  it("a saved web view with table mode rehydrates as table (sans gantt/swimlane)", () => {
    expect(sanitizeViewDisplay({ viewMode: "table" }, "position").viewMode).toBe(
      "table",
    );
    // web's other modes stay unsupported → fall back to list.
    expect(sanitizeViewDisplay({ viewMode: "swimlane" }, "position").viewMode).toBe(
      "list",
    );
  });
});
