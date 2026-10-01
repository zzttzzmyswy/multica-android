/**
 * `applySavedView` — the display half of opening a saved view (MYS-1866).
 *
 * The codec tests pin the serialize/read contract; this pins that the value
 * actually REACHES the store. Without it a view could round-trip perfectly in
 * the codec and still leave the surface showing the previous chips, because
 * `applySavedView` is a hand-written field list that the compiler cannot check
 * against `IssueViewDisplayPatch`.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/data/api", () => ({ api: {} }));

import { applySavedView } from "./saved-view-apply";
import { useActiveIssueViewStore } from "@/data/stores/active-issue-view-store";
import type { IssueView } from "@multica/core/api/schemas";

const CONTAINER = "ws-1:workspace:null";

function view(display: Record<string, unknown>): IssueView {
  return {
    id: "view-1",
    name: "Mine",
    query: { statusFilters: ["todo"] },
    display,
    revision: 1,
  } as unknown as IssueView;
}

/** Minimal stand-in for a zustand view store's `setState`. */
function makeStore() {
  let state: Record<string, unknown> = {};
  return {
    setState: (partial: Record<string, unknown>) => {
      state = { ...state, ...partial };
    },
    get: () => state,
  };
}

describe("applySavedView", () => {
  it("restores the view's custom-property selection into the store", () => {
    const store = makeStore();
    applySavedView({
      view: view({ cardPropertyIds: ["prop-a", "prop-b"] }),
      store,
      containerKey: CONTAINER,
      sortBy: "position",
    });
    expect(store.get().cardPropertyIds).toEqual(["prop-a", "prop-b"]);
  });

  it("restores the built-in card fields from the same display blob", () => {
    const store = makeStore();
    applySavedView({
      view: view({
        cardProperties: { priority: false, labels: true },
        cardPropertyIds: ["prop-a"],
      }),
      store,
      containerKey: CONTAINER,
      sortBy: "position",
    });
    // Per-key fallback: only the explicit `false` turns a field off.
    expect(store.get().cardProperties).toMatchObject({
      priority: false,
      labels: true,
      assignee: true,
    });
  });

  it("lands a view with no cardPropertyIds on the empty default, not undefined", () => {
    // A view saved before the key existed must write `[]`, not leave the
    // previous view's selection in place.
    const store = makeStore();
    applySavedView({
      view: view({ viewMode: "board" }),
      store,
      containerKey: CONTAINER,
      sortBy: "position",
    });
    expect(store.get().cardPropertyIds).toEqual([]);
  });

  it("marks the view active for its container", () => {
    const store = makeStore();
    applySavedView({
      view: view({ cardPropertyIds: [] }),
      store,
      containerKey: CONTAINER,
      sortBy: "position",
    });
    expect(
      useActiveIssueViewStore.getState().active[CONTAINER],
    ).toBe("view-1");
  });
});
