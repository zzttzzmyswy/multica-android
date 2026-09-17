/**
 * Iteration-134 additions to the table-columns slice: per-column widths and
 * user-controlled column order.
 *
 * Web (packages/core/issues/stores/view-store.ts) keeps both on the view
 * store: `tableColumnWidths` (TanStack column sizing) and `reorderTableColumn`
 * (dnd-kit drag end). Mobile has no dnd-kit and a phone-width table, so the
 * order gesture is an explicit move-up / move-down pair — the same array
 * mutation, expressed for touch.
 *
 * Invariants carried over from the visibility slice: `title` is permanent and
 * always first, and every mutation returns the state unchanged when it would
 * break that.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createStore } from "zustand/vanilla";
import {
  COLUMN_WIDTH_MAX,
  COLUMN_WIDTH_MIN,
  columnWidthOf,
  createTableColumnActions,
  DEFAULT_COLUMN_WIDTHS,
  defaultTableColumns,
  defaultTableColumnWidths,
  nextColumnWidth,
  PROPERTY_COLUMN_WIDTH,
  type TableColumnKey,
  type TableColumnsSlice,
} from "./issue-table-columns";

function makeStore() {
  return createStore<TableColumnsSlice>((set) => ({
    tableColumns: defaultTableColumns(),
    tableColumnWidths: defaultTableColumnWidths(),
    ...createTableColumnActions(set),
  }));
}

describe("columnWidthOf", () => {
  it("falls back to the system default for an un-resized column", () => {
    expect(columnWidthOf("status", {})).toBe(DEFAULT_COLUMN_WIDTHS.status);
    expect(columnWidthOf("identifier", {})).toBe(DEFAULT_COLUMN_WIDTHS.identifier);
  });

  it("uses the property width for property columns and unknown keys", () => {
    expect(columnWidthOf("property:def-1" as TableColumnKey, {})).toBe(
      PROPERTY_COLUMN_WIDTH,
    );
  });

  it("prefers a stored override", () => {
    expect(columnWidthOf("status", { status: 210 })).toBe(210);
  });

  it("clamps a stored override into the allowed range", () => {
    expect(columnWidthOf("status", { status: 10 })).toBe(COLUMN_WIDTH_MIN);
    expect(columnWidthOf("status", { status: 9999 })).toBe(COLUMN_WIDTH_MAX);
  });
});

describe("setTableColumnWidth", () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    store = makeStore();
  });

  it("stores a rounded, clamped width under the column key", () => {
    store.getState().setTableColumnWidth("status", 180.4);
    expect(store.getState().tableColumnWidths).toEqual({ status: 180 });
  });

  it("clamps to the floor and the ceiling", () => {
    store.getState().setTableColumnWidth("status", 5);
    expect(store.getState().tableColumnWidths.status).toBe(COLUMN_WIDTH_MIN);
    store.getState().setTableColumnWidth("status", 5000);
    expect(store.getState().tableColumnWidths.status).toBe(COLUMN_WIDTH_MAX);
  });

  it("drops the override when the width equals the system default", () => {
    store.getState().setTableColumnWidth("status", 177);
    store.getState().setTableColumnWidth("status", DEFAULT_COLUMN_WIDTHS.status);
    expect(store.getState().tableColumnWidths.status).toBeUndefined();
  });

  it("touches only the target column", () => {
    store.getState().setTableColumnWidth("status", 200);
    expect(store.getState().tableColumnWidths).toEqual({ status: 200 });
  });
});

describe("reorderTableColumn", () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    store = makeStore();
    // A property column so the property branch is covered too.
    store.getState().toggleTableColumn("property:def-1" as TableColumnKey);
  });

  it("moves a column one slot towards the front", () => {
    store.getState().reorderTableColumn("priority", -1);
    expect(store.getState().tableColumns.slice(0, 5)).toEqual([
      "title",
      "identifier",
      "priority",
      "status",
      "assignee",
    ]);
  });

  it("moves a column one slot towards the back", () => {
    store.getState().reorderTableColumn("identifier", 1);
    expect(store.getState().tableColumns.slice(0, 4)).toEqual([
      "title",
      "status",
      "identifier",
      "priority",
    ]);
  });

  it("moves a property column like any other", () => {
    const last = store.getState().tableColumns.length - 1;
    expect(store.getState().tableColumns[last]).toBe("property:def-1");
    store.getState().reorderTableColumn("property:def-1" as TableColumnKey, -1);
    expect(store.getState().tableColumns[last - 1]).toBe("property:def-1");
  });

  it("never moves title off the front", () => {
    store.getState().reorderTableColumn("title", 1);
    expect(store.getState().tableColumns[0]).toBe("title");
  });

  it("never moves title off the front by stepping it forward either", () => {
    // The pinned column has no place in the scroller, so a forward step has
    // to be refused as well — it would otherwise swap title with its
    // neighbour and leave a movable column in the pinned slot.
    const before = store.getState().tableColumns;
    store.getState().reorderTableColumn("title", -1);
    store.getState().reorderTableColumn("title", 1);
    expect(store.getState().tableColumns).toEqual(before);
    expect(store.getState().tableColumns[0]).toBe("title");
  });

  it("is a no-op past either end", () => {
    const before = store.getState().tableColumns;
    store.getState().reorderTableColumn("identifier", -1);
    expect(store.getState().tableColumns).toEqual(before);
    store.getState().reorderTableColumn(store.getState().tableColumns.at(-1)!, 1);
    expect(store.getState().tableColumns).toEqual(before);
  });

  it("is a no-op for a hidden column", () => {
    const before = store.getState().tableColumns;
    store.getState().reorderTableColumn("labels", -1);
    expect(store.getState().tableColumns).toEqual(before);
  });
});

describe("resetTableColumns", () => {
  it("restores both the default order and the default widths", () => {
    const store = makeStore();
    store.getState().toggleTableColumn("labels");
    store.getState().setTableColumnWidth("status", 250);
    store.getState().resetTableColumns();
    expect(store.getState().tableColumns).toEqual(defaultTableColumns());
    expect(store.getState().tableColumnWidths).toEqual({});
  });
});

describe("nextColumnWidth (drag maths)", () => {
  it("adds the gesture delta to the width the drag started from", () => {
    expect(nextColumnWidth(120, 40)).toBe(160);
    expect(nextColumnWidth(120, -40)).toBe(80);
  });

  it("clamps during the drag so the preview matches the committed value", () => {
    expect(nextColumnWidth(120, -500)).toBe(COLUMN_WIDTH_MIN);
    expect(nextColumnWidth(120, 500)).toBe(COLUMN_WIDTH_MAX);
  });
});
