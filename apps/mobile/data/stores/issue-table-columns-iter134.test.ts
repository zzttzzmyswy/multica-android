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
  columnMoveAvailability,
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

  it("takes the width the gesture actually started from, not a mount-time one", () => {
    // Regression guard for the resize handle reading its origin from a
    // frozen closure: the second drag on a column must continue from where
    // the first left it (120 -> 200 -> 220), not snap back to the default.
    const first = nextColumnWidth(120, 80);
    const second = nextColumnWidth(first, 20);
    expect(first).toBe(200);
    expect(second).toBe(220);
  });
});

describe("columnMoveAvailability", () => {
  // Slot 0 is the pinned title; slot 1 is the leftmost a scrolled column can
  // reach. These bounds have to agree with `reorderTableColumn`'s guards, or
  // the menu offers a chevron the store refuses to act on.
  const COUNT = 6;

  it("refuses both directions in the pinned slot", () => {
    // The menu does not even render a move affordance for `title` (it is not
    // movable at all), so both false is the honest answer here.
    expect(columnMoveAvailability(0, COUNT)).toEqual({
      left: false,
      right: false,
    });
  });

  it("refuses left from the leftmost scrolled slot", () => {
    expect(columnMoveAvailability(1, COUNT).left).toBe(false);
    expect(columnMoveAvailability(1, COUNT).right).toBe(true);
  });

  it("allows both in the middle", () => {
    expect(columnMoveAvailability(3, COUNT)).toEqual({
      left: true,
      right: true,
    });
  });

  it("refuses right from the last slot", () => {
    expect(columnMoveAvailability(COUNT - 1, COUNT)).toEqual({
      left: true,
      right: false,
    });
  });

  it("refuses both for a column that is not visible", () => {
    expect(columnMoveAvailability(-1, COUNT)).toEqual({
      left: false,
      right: false,
    });
  });

  it("agrees with the store on every slot", () => {
    const columns = makeStore().getState().tableColumns;
    for (let i = 1; i < columns.length; i += 1) {
      const available = columnMoveAvailability(i, columns.length);
      const store = makeStore();
      store.getState().reorderTableColumn(columns[i], -1);
      const before = [...columns];
      const expected = [...before];
      expected[i] = expected[i - 1];
      expected[i - 1] = columns[i];
      // left is available for every slot past the leftmost scrolled one.
      expect(store.getState().tableColumns, `slot ${i} left`).toEqual(
        available.left ? expected : before,
      );
    }
  });
});
