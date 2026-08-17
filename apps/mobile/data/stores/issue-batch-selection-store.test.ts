import { beforeEach, describe, expect, it } from "vitest";
import { useIssueBatchSelectionStore } from "./issue-batch-selection-store";

const store = () => useIssueBatchSelectionStore.getState();

beforeEach(() => {
  store().exitSelection();
});

describe("issue batch selection store", () => {
  it("starts idle — selection off, nothing selected", () => {
    const s = useIssueBatchSelectionStore.getState();
    expect(s.selectionMode).toBe(false);
    expect(s.selectedIds.size).toBe(0);
  });

  it("enterSelection() enters selection mode without selecting anything", () => {
    store().enterSelection();
    store().toggle("a");
    const s = useIssueBatchSelectionStore.getState();
    expect(s.selectionMode).toBe(true);
    expect(s.selectedIds.has("a")).toBe(true);
  });

  it("enterSelection(id) enters selection mode and pre-selects that id", () => {
    store().enterSelection("a");
    const s = useIssueBatchSelectionStore.getState();
    expect(s.selectionMode).toBe(true);
    expect(s.selectedIds.has("a")).toBe(true);
  });

  it("toggle adds then removes an id", () => {
    store().enterSelection();
    store().toggle("a");
    expect(store().selectedIds.has("a")).toBe(true);
    store().toggle("a");
    expect(store().selectedIds.has("a")).toBe(false);
    expect(store().selectedIds.size).toBe(0);
  });

  it("setSelected replaces the full selection", () => {
    store().enterSelection();
    store().setSelected(["a", "b"]);
    expect(store().selectedIds.size).toBe(2);
    store().setSelected(["c"]);
    expect(store().selectedIds.has("a")).toBe(false);
    expect(store().selectedIds.has("c")).toBe(true);
  });

  it("clear empties selection but stays in selection mode", () => {
    store().enterSelection("a");
    store().clear();
    expect(store().selectedIds.size).toBe(0);
    expect(store().selectionMode).toBe(true);
  });

  it("exitSelection leaves selection mode and empties selection", () => {
    store().enterSelection("a");
    store().exitSelection();
    expect(store().selectionMode).toBe(false);
    expect(store().selectedIds.size).toBe(0);
  });

  it("exits selection mode when the last selected id is toggled off", () => {
    store().enterSelection("a");
    store().toggle("a");
    expect(store().selectionMode).toBe(false);
    expect(store().selectedIds.size).toBe(0);
  });
});