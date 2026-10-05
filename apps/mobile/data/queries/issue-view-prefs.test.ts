/**
 * View-bar preference pure-logic tests (iteration-67). The mutation hook
 * only wires the optimistic contract to the query cache (no renderer in the
 * Node vitest lane), so this file covers the two pure functions that decide
 * the bar's shape and the stale-id cleanup web's savePrefs performs.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/data/api", () => ({ api: {} }));

import {
  applyViewBarPrefs,
  sanitizeViewBarPrefs,
  showsViewBarManage,
  viewBarItemId,
} from "./issue-view-prefs";

const ITEMS = [
  { barItemId: "view:a", name: "A" },
  { barItemId: "view:b", name: "B" },
  { barItemId: "view:c", name: "C" },
];

describe("applyViewBarPrefs", () => {
  it("applies order and appends items absent from it", () => {
    const { ordered } = applyViewBarPrefs(ITEMS, {
      hidden: [],
      order: ["view:c", "view:a"],
    });
    expect(ordered.map((i) => i.barItemId)).toEqual(["view:c", "view:a", "view:b"]);
  });

  it("drops hidden items from visible but keeps them in ordered", () => {
    const { visible, hiddenSet, ordered } = applyViewBarPrefs(ITEMS, {
      hidden: ["view:b"],
      order: [],
    });
    expect(visible.map((i) => i.barItemId)).toEqual(["view:a", "view:c"]);
    expect(hiddenSet.has("view:b")).toBe(true);
    expect(ordered.map((i) => i.barItemId)).toEqual(["view:a", "view:b", "view:c"]);
  });

  it("ignores unknown ids (deleted views) in order and hidden", () => {
    const { visible, hiddenSet } = applyViewBarPrefs(ITEMS, {
      hidden: ["view:gone"],
      order: ["view:gone", "view:b"],
    });
    expect(visible.map((i) => i.barItemId)).toEqual(["view:b", "view:a", "view:c"]);
    // An unknown hidden entry stays in the set but matches nothing, so it is
    // inert — web's applyViewBarPrefs behaves identically.
    expect(hiddenSet.has("view:gone")).toBe(true);
  });

  it("never hides the anchor built-in", () => {
    const { visible, hiddenSet } = applyViewBarPrefs(
      [{ barItemId: "builtin:default", name: "Default" }, ...ITEMS],
      { hidden: ["builtin:default"], order: [] },
      "builtin:default",
    );
    expect(visible.some((i) => i.barItemId === "builtin:default")).toBe(true);
    expect(hiddenSet.has("builtin:default")).toBe(false);
  });

  it("empty prefs keeps natural order and nothing hidden", () => {
    const { visible, hiddenSet } = applyViewBarPrefs(ITEMS, undefined);
    expect(visible.map((i) => i.barItemId)).toEqual(["view:a", "view:b", "view:c"]);
    expect(hiddenSet.size).toBe(0);
  });
});

describe("sanitizeViewBarPrefs", () => {
  it("drops deleted ids from both hidden and order", () => {
    const out = sanitizeViewBarPrefs(
      { hidden: ["view:a", "view:gone"], order: ["view:gone", "view:b", "view:a"] },
      ["view:a", "view:b", "view:c"],
    );
    expect(out.hidden).toEqual(["view:a"]);
    expect(out.order).toEqual(["view:b", "view:a"]);
  });
});

describe("viewBarItemId", () => {
  it("uses the web view:<id> vocabulary", () => {
    expect(viewBarItemId("abc")).toBe("view:abc");
  });
});

describe("showsViewBarManage", () => {
  it("shows for two or more items even with nothing hidden", () => {
    expect(showsViewBarManage({ itemCount: 2, hasHidden: false })).toBe(true);
    expect(showsViewBarManage({ itemCount: 5, hasHidden: false })).toBe(true);
  });

  it("shows for a single item only while something is hidden", () => {
    // Reordering needs two, but revealing needs one: a lone hidden view leaves
    // the bar empty, and this is the only route back to it.
    expect(showsViewBarManage({ itemCount: 1, hasHidden: true })).toBe(true);
    expect(showsViewBarManage({ itemCount: 1, hasHidden: false })).toBe(false);
  });

  it("stays hidden on an empty bar with nothing hidden", () => {
    // Nothing to reorder and nothing to reveal — the button would open a dialog
    // over an empty list.
    expect(showsViewBarManage({ itemCount: 0, hasHidden: false })).toBe(false);
  });
});