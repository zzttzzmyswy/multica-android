/**
 * Filter slice behaviors added in iteration 64 (MYS-419): custom-property
 * filters (`propertyFilters`) and the date window (`dateFilter`).
 *
 * Semantics mirror web's `packages/core/issues/stores/view-store.ts`:
 *   - property filters are OR within a definition and AND across
 *     definitions; checkbox definitions use "true"/"false" pseudo-options;
 *     once trimmed to empty a definition is dropped from the record.
 *   - `dateFilter` is a date-only `{ field, from, to }`; the server window
 *     converts it to a half-open instant band `[fromLocalMidnight,
 *     toLocalMidnight + 1d)` exactly like web's
 *     `issueDateFilterToApiParams` (surface/use-issue-surface-controller.ts).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createStore } from "zustand/vanilla";
import {
  buildIssueWindow,
  createIssueFilterActions,
  defaultIssueFilterSlice,
  hasActiveIssueFilters,
  type IssueFilterSlice,
} from "./issue-filter-slice";

/** Minimal zustand store carrying exactly the filter slice. */
function makeStore() {
  return createStore<IssueFilterSlice>((set) => ({
    ...(defaultIssueFilterSlice() as IssueFilterSlice),
    propertyFilters: {},
    dateFilter: null,
    ...createIssueFilterActions(set),
  }));
}

describe("issue filter slice: customs + dates", () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    store = makeStore();
  });

  it("defaults both new dimensions to empty / no filter", () => {
    expect(store.getState().propertyFilters).toEqual({});
    expect(store.getState().dateFilter).toBeNull();
    expect(hasActiveIssueFilters(store.getState())).toBe(false);
  });

  it("togglePropertyFilter adds, grows and toggles options, dropping an emptied definition", () => {
    store.getState().togglePropertyFilter("def-1", "opt-a");
    expect(store.getState().propertyFilters).toEqual({
      "def-1": ["opt-a"],
    });
    store.getState().togglePropertyFilter("def-1", "opt-b");
    expect(store.getState().propertyFilters).toEqual({
      "def-1": ["opt-a", "opt-b"],
    });
    store.getState().togglePropertyFilter("def-1", "opt-a");
    expect(store.getState().propertyFilters).toEqual({
      "def-1": ["opt-b"],
    });
    store.getState().togglePropertyFilter("def-1", "opt-b");
    expect(store.getState().propertyFilters).toEqual({});
  });

  it("keeps filters from different definitions separate (AND across definitions)", () => {
    store.getState().togglePropertyFilter("def-1", "a");
    store.getState().togglePropertyFilter("def-2", "b");
    expect(store.getState().propertyFilters).toEqual({
      "def-1": ["a"],
      "def-2": ["b"],
    });
  });

  it("handles checkbox true/false pseudo-options", () => {
    store.getState().togglePropertyFilter("chk", "true");
    expect(store.getState().propertyFilters).toEqual({ chk: ["true"] });
    store.getState().togglePropertyFilter("chk", "false");
    expect(store.getState().propertyFilters).toEqual({
      chk: ["true", "false"],
    });
  });

  it("clearPropertyFilter removes one definition and leaves others", () => {
    store.getState().togglePropertyFilter("def-1", "a");
    store.getState().togglePropertyFilter("def-2", "b");
    store.getState().clearPropertyFilter("def-1");
    expect(store.getState().propertyFilters).toEqual({ "def-2": ["b"] });
  });

  it("setDateFilter sets and clears", () => {
    const filter = {
      field: "created_at",
      from: "2026-08-01",
      to: "2026-08-07",
    } as const;
    store.getState().setDateFilter(filter);
    expect(store.getState().dateFilter).toEqual(filter);
    store.getState().setDateFilter(null);
    expect(store.getState().dateFilter).toBeNull();
  });

  it("clearFilters resets both new dimensions but keeps sort/grouping", () => {
    store.getState().togglePropertyFilter("def-1", "a");
    store.getState().setDateFilter({
      field: "updated_at",
      from: "2026-01-01",
      to: "2026-02-01",
    });
    store.getState().setSortBy("title");
    store.getState().setGrouping("assignee");
    store.getState().clearFilters();
    expect(store.getState().propertyFilters).toEqual({});
    expect(store.getState().dateFilter).toBeNull();
    expect(store.getState().sortBy).toBe("title");
    expect(store.getState().grouping).toBe("assignee");
  });

  it("clearFilterDimension('property:<id>') removes only that definition", () => {
    store.getState().togglePropertyFilter("def-1", "a");
    store.getState().togglePropertyFilter("def-2", "b");
    store.getState().clearFilterDimension("property:def-1");
    expect(store.getState().propertyFilters).toEqual({ "def-2": ["b"] });
  });

  it("clearFilterDimension('property:missing') is a no-op", () => {
    store.getState().toggleStatusFilter("todo");
    store.getState().clearFilterDimension("property:missing");
    expect(store.getState().propertyFilters).toEqual({});
    expect(store.getState().statusFilters).toEqual(["todo"]);
  });

  it("clearFilterDimension('date') clears only the date window", () => {
    store.getState().toggleStatusFilter("todo");
    store.getState().setDateFilter({
      field: "created_at",
      from: "2026-08-01",
      to: "2026-08-07",
    });
    store.getState().clearFilterDimension("date");
    expect(store.getState().dateFilter).toBeNull();
    expect(store.getState().statusFilters).toEqual(["todo"]);
  });
});

describe("buildIssueWindow", () => {
  let store: ReturnType<typeof makeStore>;
  const snapshot = () => ({ ...store.getState() });

  beforeEach(() => {
    store = makeStore();
  });

  it("omits both new dimensions when inactive", () => {
    const win = buildIssueWindow(snapshot());
    expect("properties" in win).toBe(false);
    expect("date_field" in win).toBe(false);
  });

  it("serializes propertyFilters as the AND-of-ORs record the server parses", () => {
    store.getState().togglePropertyFilter("def-1", "a");
    store.getState().togglePropertyFilter("def-2", "b");
    store.getState().togglePropertyFilter("def-2", "c");
    const win = buildIssueWindow(snapshot());
    expect(win.properties).toEqual({
      "def-1": ["a"],
      "def-2": ["b", "c"],
    });
  });

  it("emits a half-open instant range [from, to+1d) for single-day presets", () => {
    store.getState().setDateFilter({
      field: "created_at",
      from: "2026-08-01",
      to: "2026-08-01",
    });
    const win = buildIssueWindow(snapshot());
    expect(win.date_field).toBe("created_at");
    const startMs = new Date(win.date_start as string).getTime();
    const endMs = new Date(win.date_end as string).getTime();
    // One calendar day, independent of the test runner's timezone.
    expect(endMs - startMs).toBe(86400000);
  });

  it("spans the full closed range plus one day for multi-day windows", () => {
    store.getState().setDateFilter({
      field: "updated_at",
      from: "2026-08-01",
      to: "2026-08-07",
    });
    const win = buildIssueWindow(snapshot());
    expect(win.date_field).toBe("updated_at");
    const startMs = new Date(win.date_start as string).getTime();
    const endMs = new Date(win.date_end as string).getTime();
    // 7 calendar days from 08-01 to 08-08 (to +1 day).
    expect(endMs - startMs).toBe(7 * 86400000);
  });

  it("keeps all other dimensions through when property/date are active", () => {
    store.getState().toggleStatusFilter("in_review");
    store.getState().togglePropertyFilter("def-1", "a");
    store.getState().setDateFilter({
      field: "created_at",
      from: "2026-08-01",
      to: "2026-08-01",
    });
    const win = buildIssueWindow(snapshot());
    expect(win.statuses).toEqual(["in_review"]);
    expect(win.properties).toEqual({ "def-1": ["a"] });
    expect(win.date_field).toBe("created_at");
  });
});

describe("hasActiveIssueFilters", () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    store = makeStore();
  });

  it("true when a property filter is active", () => {
    store.getState().togglePropertyFilter("def-1", "a");
    expect(hasActiveIssueFilters(store.getState())).toBe(true);
  });

  it("true when the date window is set", () => {
    store.getState().setDateFilter({
      field: "updated_at",
      from: "2026-08-01",
      to: "2026-08-07",
    });
    expect(hasActiveIssueFilters(store.getState())).toBe(true);
  });
});