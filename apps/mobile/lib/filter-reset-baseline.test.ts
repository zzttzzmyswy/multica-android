/**
 * Iteration 258 (MYS-2236) — Reset inside a saved view returns TO the view.
 *
 * Web's rule (`issues-header.tsx:1513-1527`): with a `viewBaseline`, Reset
 * calls `resetFiltersTo(viewBaseline.raw)`; without one it calls
 * `clearFilters()`. Mobile's filter sheet called `clearFilters()`
 * unconditionally, so a Reset inside a saved view deleted the view's own
 * definition — the list emptied out from under a name that still claimed to
 * describe it. The chip bar behind the same sheet already did the right thing
 * (`clearDimensionToBaseline`), so the product answered「重置」 two ways
 * depending on which control you reached for.
 *
 * These tests pin the plan, not the store (the store's `resetFiltersTo` has its
 * own suite); the wiring test next to this one pins that the SHEET uses it.
 */
import { describe, expect, it } from "vitest";
import {
  activeFilterDimensions,
  applyFilterReset,
  baselineFromViewQuery,
  planFilterReset,
  type IssueFilterDims,
} from "@/data/stores/issue-view-codec";

const EMPTY: IssueFilterDims = {
  statusFilters: [],
  priorityFilters: [],
  assigneeFilters: [],
  includeNoAssignee: false,
  creatorFilters: [],
  projectFilters: [],
  includeNoProject: false,
  labelFilters: [],
  propertyFilters: {},
  dateFilter: null,
  workingOnly: false,
};

const VIEW_QUERY = {
  statusFilters: ["todo", "in_progress"],
  priorityFilters: ["high"],
  assigneeFilters: [{ type: "member", id: "u-1" }],
  includeNoAssignee: false,
  creatorFilters: [],
  projectFilters: ["proj-1"],
  includeNoProject: false,
  labelFilters: [],
  propertyFilters: {},
  agentRunningFilter: false,
};

/** The live slice after a view has been applied — what the sheet sees. */
function viewState(
  overrides: Partial<IssueFilterDims> = {},
): IssueFilterDims {
  return {
    statusFilters: ["todo", "in_progress"],
    priorityFilters: ["high"],
    assigneeFilters: [{ type: "member", id: "u-1" }],
    includeNoAssignee: false,
    creatorFilters: [],
    projectFilters: ["proj-1"],
    includeNoProject: false,
    labelFilters: [],
    propertyFilters: {},
    dateFilter: null,
    workingOnly: false,
    ...overrides,
  };
}

describe("planFilterReset", () => {
  it("returns the VIEW's own conditions when a view is open", () => {
    const baseline = baselineFromViewQuery(VIEW_QUERY);
    const plan = planFilterReset(baseline);
    expect(plan.kind).toBe("to-view");
    if (plan.kind !== "to-view") throw new Error("unreachable");
    // The exact snapshot the store is reset to — this is the value the old
    // unconditional `clearFilters()` replaced with "nothing".
    expect(plan.snapshot.statusFilters).toEqual(["todo", "in_progress"]);
    expect(plan.snapshot.priorityFilters).toEqual(["high"]);
    expect(plan.snapshot.projectFilters).toEqual(["proj-1"]);
    expect(plan.snapshot.assigneeFilters).toEqual([
      { type: "member", id: "u-1" },
    ]);
  });

  it("clears when no view is open", () => {
    expect(planFilterReset(null)).toEqual({ kind: "clear" });
  });

  it("never carries a date window — views do not fix one", () => {
    const baseline = baselineFromViewQuery({
      ...VIEW_QUERY,
      dateFilter: { field: "created_at", from: "2026-01-01", to: "2026-01-02" },
    });
    const plan = planFilterReset(baseline);
    if (plan.kind !== "to-view") throw new Error("expected to-view");
    expect("dateFilter" in plan.snapshot).toBe(false);
  });
});

describe("activeFilterDimensions counts only what the user added", () => {
  it("an untouched view has NOTHING active — Reset must not offer itself", () => {
    // Web's `getActiveFilterCount(..., viewBaseline) > 0`. The old mobile code
    // used the baseline-blind `hasActiveIssueFilters`, which lit the trigger
    // and offered a Reset on a freshly-opened view whose conditions the user
    // never chose.
    const baseline = baselineFromViewQuery(VIEW_QUERY);
    expect(activeFilterDimensions(viewState(), baseline)).toEqual([]);
  });

  it("one added value in a view-fixed dimension counts as that dimension", () => {
    const baseline = baselineFromViewQuery(VIEW_QUERY);
    expect(
      activeFilterDimensions(
        viewState({ statusFilters: ["todo", "in_progress", "done"] }),
        baseline,
      ),
    ).toEqual(["status"]);
  });

  it("a dimension the view does NOT fix counts as soon as it has a value", () => {
    const baseline = baselineFromViewQuery(VIEW_QUERY);
    expect(
      activeFilterDimensions(viewState({ labelFilters: ["label-1"] }), baseline),
    ).toEqual(["label"]);
  });

  it("a REMOVAL of a view-fixed value is not an addition (web's delta rule)", () => {
    // Web's `delta()` counts `values.filter(v => !fixed.has(v)).length`, so a
    // dimension the view fixes and the user emptied contributes 0 — the same
    // answer here. The panel also disables view-fixed rows, so a removal is
    // only reachable from the chip bar, whose own reset path
    // (`clearDimensionToBaseline`) already restores the view's values.
    const baseline = baselineFromViewQuery(VIEW_QUERY);
    expect(
      activeFilterDimensions(viewState({ priorityFilters: [] }), baseline),
    ).toEqual([]);
  });

  it("without a view every active dimension counts", () => {
    expect(activeFilterDimensions(viewState(), null)).toEqual([
      "status",
      "priority",
      "assignee",
      "project",
    ]);
  });

  it("'no assignee' / 'no project' are additions on top of the view", () => {
    const baseline = baselineFromViewQuery(VIEW_QUERY);
    expect(
      activeFilterDimensions(viewState({ includeNoAssignee: true }), baseline),
    ).toEqual(["assignee"]);
    expect(
      activeFilterDimensions(viewState({ includeNoProject: true }), baseline),
    ).toEqual(["project"]);
  });

  it("a property value the VIEW fixes is not an addition", () => {
    // Without the per-definition comparison, a view that fixes a property's
    // value would report that dimension as "user-added" and offer a reset for
    // something the user never touched.
    const baseline = baselineFromViewQuery({
      ...VIEW_QUERY,
      propertyFilters: { "prop-a": ["x"] },
    });
    expect(
      activeFilterDimensions(
        viewState({ propertyFilters: { "prop-a": ["x"] } }),
        baseline,
      ),
    ).toEqual([]);
  });

  it("an ADDED value on a view-fixed property is an addition", () => {
    const baseline = baselineFromViewQuery({
      ...VIEW_QUERY,
      propertyFilters: { "prop-a": ["x"] },
    });
    expect(
      activeFilterDimensions(
        viewState({ propertyFilters: { "prop-a": ["x", "y"] } }),
        baseline,
      ),
    ).toEqual(["property:prop-a"]);
  });

  it("per-property dimensions are reported individually", () => {
    const baseline = baselineFromViewQuery(VIEW_QUERY);
    expect(
      activeFilterDimensions(
        viewState({ propertyFilters: { "prop-a": ["x"], "prop-b": ["y"] } }),
        baseline,
      ),
    ).toEqual(["property:prop-a", "property:prop-b"]);
  });

  it("the date window is a user layer no view fixes", () => {
    const baseline = baselineFromViewQuery(VIEW_QUERY);
    expect(
      activeFilterDimensions(
        viewState({
          dateFilter: { field: "created_at", from: "2026-01-01", to: "2026-01-02" },
        }),
        baseline,
      ),
    ).toEqual(["date"]);
    expect(activeFilterDimensions(EMPTY, baseline)).toEqual([]);
  });

  it("the agent-running condition counts only when the view does not fix it", () => {
    // Iteration 281: it IS a view dimension now, so an open view that fixes
    // it absorbs it (no chip, no trigger dot) — the asymmetric rule web uses
    // (`agentRunningFilter && !baseline?.agentRunning`).
    expect(
      activeFilterDimensions(viewState({ workingOnly: true }), baselineFromViewQuery(VIEW_QUERY)),
    ).toEqual(["agentRunning"]);
    expect(
      activeFilterDimensions(
        viewState({ workingOnly: true }),
        baselineFromViewQuery({ ...VIEW_QUERY, agentRunningFilter: true }),
      ),
    ).toEqual([]);
    // A view that fixes it ON with the live filter OFF adds no chip either:
    // removing a promise is not "adding a filter".
    expect(
      activeFilterDimensions(
        viewState({ workingOnly: false }),
        baselineFromViewQuery({ ...VIEW_QUERY, agentRunningFilter: true }),
      ),
    ).toEqual([]);
  });
});

describe("applyFilterReset restores the view, and nulls the date on every path", () => {
  /** Records what a Reset did, in call order. */
  function recorder() {
    const calls: string[] = [];
    const actions = {
      resetFiltersTo: (snapshot: unknown) => {
        calls.push(`resetFiltersTo:${JSON.stringify(snapshot)}`);
      },
      clearFilters: () => calls.push("clearFilters"),
      setDateFilter: (value: unknown) => calls.push(`setDateFilter:${value}`),
    };
    return { calls, actions };
  }

  it("inside a view: restores the view's snapshot and nulls the date", () => {
    const baseline = baselineFromViewQuery({
      ...VIEW_QUERY,
      agentRunningFilter: true,
    });
    const r = recorder();
    applyFilterReset(baseline, r.actions);
    expect(r.calls[0]).toMatch(/^resetFiltersTo:/);
    expect(r.calls).toContain("setDateFilter:null");
    // Never the "erase everything" primitive while a view is open.
    expect(r.calls).not.toContain("clearFilters");
    // The agent-running condition travels INSIDE the snapshot (iteration
    // 281), so the view's own `true` is restored rather than toggled away.
    expect(r.calls[0]).toContain('"agentRunningFilter":true');
  });

  it("outside a view: clears, and still nulls the date", () => {
    // The date window is outside `clearFilters`' contract, so it is trivially
    // forgotten at a call site that only thinks about the snapshot.
    const r = recorder();
    applyFilterReset(null, r.actions);
    expect(r.calls).toContain("clearFilters");
    expect(r.calls).toContain("setDateFilter:null");
  });
});
