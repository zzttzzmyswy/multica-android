/**
 * 「智能体运行中」 must be a VIEW dimension on mobile, not a session toggle
 * (iteration 281, MYS-2539).
 *
 * Upstream `4d85b17ff` (MUL-8436) promoted `agentRunningFilter` from a
 * throwaway quick switch to a first-class filter field: it goes into
 * `FilterSnapshot`, into `issueViewDefinitionFromState`'s query blob, into
 * the chips bar, into `modifiedFilterDimensions`, and it is persisted.
 *
 * Mobile had the PREDICATE (`workingOnly`) but kept the OLD contract —
 * `issue-filter-slice.ts` states in prose that the field is "Deliberately NOT
 * persisted and NOT part of `IssueFilterSnapshot`". The consequence is a
 * one-way loss across clients: a view saved on web with "Agent is running"
 * opens on the phone with that condition silently dropped, so the same view
 * shows a different N depending on which client you opened it in. That is
 * the exact parity rule apps/mobile/CLAUDE.md forbids ("Counts / visibility —
 * same N for the same filter").
 *
 * These tests are written against the BEHAVIOUR (what a view blob round-trips
 * and what a reset restores), not against the field's name, so they keep
 * holding if the mobile-side spelling moves.
 */
import { describe, expect, it } from "vitest";
import {
  activeFilterDimensions,
  applyFilterReset,
  baselineFromViewQuery,
  clearDimensionToBaseline,
  issueFilterDelta,
  sanitizeViewQuery,
  viewMatchesSlice,
  viewQueryFromSnapshot,
} from "@/data/stores/issue-view-codec";
import {
  createIssueFilterActions,
  defaultIssueFilterSlice,
  type IssueFilterSlice,
} from "@/data/stores/issue-filter-slice";
import { createStore } from "zustand/vanilla";

/** A store of the shared filter slice — the same shape all three issue
 *  surfaces own, so the actions under test are the real ones. */
function makeStore() {
  return createStore<IssueFilterSlice>()((set) => ({
    ...defaultIssueFilterSlice(),
    ...createIssueFilterActions<IssueFilterSlice>(set),
  }));
}

/** The minimal slice `viewQueryFromSnapshot` accepts. */
function snapshotOf(state: IssueFilterSlice) {
  return {
    statusFilters: state.statusFilters,
    priorityFilters: state.priorityFilters,
    assigneeFilters: state.assigneeFilters,
    includeNoAssignee: state.includeNoAssignee,
    creatorFilters: state.creatorFilters,
    projectFilters: state.projectFilters,
    includeNoProject: state.includeNoProject,
    labelFilters: state.labelFilters,
    propertyFilters: state.propertyFilters,
    workingOnly: state.workingOnly,
  };
}

describe("a web view that fixes 「Agent is running」 survives the trip to mobile", () => {
  it("is read back out of the view's query blob", () => {
    // Exactly what web's `issueViewDefinitionFromState` writes
    // (packages/core/issue-views/definition.ts) once the view was saved with
    // the agent-running filter on, with every other dimension at its default
    // so the assertion cannot be satisfied by an unrelated field.
    const query = {
      statusFilters: [],
      priorityFilters: [],
      assigneeFilters: [],
      includeNoAssignee: false,
      creatorFilters: [],
      projectFilters: [],
      includeNoProject: false,
      labelFilters: [],
      propertyFilters: {},
      agentRunningFilter: true,
    };

    // Without this the condition is dropped and the phone shows the whole
    // workspace under a view that promised "only what an agent is running".
    expect(sanitizeViewQuery(query).agentRunningFilter).toBe(true);
    expect(baselineFromViewQuery(query).agentRunningFilter).toBe(true);
    expect(baselineFromViewQuery(query).raw.agentRunningFilter).toBe(true);
  });

  it("a view WITHOUT the key reads as off, not as an unknown third state", () => {
    // Every view created before the upstream change has no key at all. It
    // must open as "no agent-running condition", which is what it meant.
    expect(sanitizeViewQuery({}).agentRunningFilter).toBe(false);
    expect(baselineFromViewQuery({}).agentRunningFilter).toBe(false);
  });

  it("a non-boolean in the blob is not coerced into a filter", () => {
    // The blob is opaque JSON from the server; only a real `true` counts
    // (web `baseline.ts:129`: `query.agentRunningFilter === true`).
    for (const junk of ["true", 1, {}, [], null]) {
      expect(
        sanitizeViewQuery({ agentRunningFilter: junk }).agentRunningFilter,
      ).toBe(false);
    }
  });
});

describe("a view SAVED on mobile carries the condition back", () => {
  it("writes the key when the filter is on", () => {
    const store = makeStore();
    store.getState().toggleWorkingOnly();

    const query = viewQueryFromSnapshot(snapshotOf(store.getState()));
    expect(query.agentRunningFilter).toBe(true);
  });

  it("writes an explicit false when the filter is off", () => {
    // Written rather than omitted: a re-save of a web view that HAD the
    // condition must clear it for every client, not leave the old `true`
    // sitting in the blob.
    const query = viewQueryFromSnapshot(snapshotOf(makeStore().getState()));
    expect(query).toHaveProperty("agentRunningFilter", false);
  });

  it("round-trips through the codec", () => {
    const store = makeStore();
    store.getState().toggleWorkingOnly();
    const query = viewQueryFromSnapshot(snapshotOf(store.getState()));
    expect(sanitizeViewQuery(query).agentRunningFilter).toBe(true);
  });
});

describe("the open view's own condition is not 'active filtering'", () => {
  it("contributes no chip and does not light the trigger", () => {
    const baseline = baselineFromViewQuery({ agentRunningFilter: true });
    const state = { ...defaultIssueFilterSlice(), workingOnly: true };

    // Same rule every other dimension follows: the view name carries its own
    // conditions, chips show only what the user layered on top.
    expect(activeFilterDimensions(state, baseline)).toEqual([]);
    expect(issueFilterDelta(state, baseline).agentRunning).toBe(false);
  });

  it("an addition ON TOP of the view does both", () => {
    const baseline = baselineFromViewQuery({ agentRunningFilter: false });
    const state = { ...defaultIssueFilterSlice(), workingOnly: true };

    expect(activeFilterDimensions(state, baseline)).toEqual([
      "agentRunning",
    ]);
    expect(issueFilterDelta(state, baseline).agentRunning).toBe(true);
  });

  it("outside any view it counts on its own", () => {
    const state = { ...defaultIssueFilterSlice(), workingOnly: true };
    expect(activeFilterDimensions(state, null)).toEqual(["agentRunning"]);
    expect(issueFilterDelta(state, null).agentRunning).toBe(true);
  });

  it("a view fixing the condition, with the live filter OFF, is a modification but not a chip", () => {
    // The asymmetry is web's, deliberately (`issues-header.tsx`
    // `if (state.agentRunningFilter && !baseline?.agentRunning) count++`).
    // Turning the filter off does not ADD a condition the user could remove
    // with a chip — it removes one the view promised. The "modified" dot is
    // what reports that, and re-opening the view is what clears it.
    const fixing = baselineFromViewQuery({ agentRunningFilter: true });
    const off = { ...defaultIssueFilterSlice(), workingOnly: false };

    expect(activeFilterDimensions(off, fixing)).toEqual([]);
    expect(issueFilterDelta(off, fixing).agentRunning).toBe(false);
    // …but the dot does light, which the next describe block asserts.
    expect(
      viewMatchesSlice(
        { query: { agentRunningFilter: true }, display: {} },
        {
          ...defaultIssueFilterSlice(),
          workingOnly: false,
          swimlaneGrouping: "assignee",
          tableColumns: ["title"],
          tableColumnWidths: {},
          tableGrouping: "none",
        } as never,
        "list",
      ),
    ).toBe(false);
  });
});

describe("reset restores the view's condition instead of clearing it", () => {
  it("a chip removal returns the dimension to the view's value", () => {
    const baseline = baselineFromViewQuery({ agentRunningFilter: true });
    const state = { ...defaultIssueFilterSlice(), workingOnly: false };

    expect(
      clearDimensionToBaseline(state, "agentRunning", baseline)
        .agentRunningFilter,
    ).toBe(true);
  });

  it("Reset inside a view restores it (it is part of the snapshot now)", () => {
    const baseline = baselineFromViewQuery({ agentRunningFilter: true });
    const changes: Array<Record<string, unknown>> = [];
    const actions = {
      resetFiltersTo: (snapshot: unknown) => changes.push({ snapshot }),
      clearFilters: () => changes.push({ cleared: true }),
      setDateFilter: () => {},
    };

    applyFilterReset(baseline, actions as never);

    // The snapshot now carries the condition, so no extra toggle is needed —
    // and an extra toggle would be actively wrong here (it would flip the
    // view's own `true` back to `false`).
    expect(changes).toHaveLength(1);
    expect(changes[0].cleared).toBeUndefined();
    expect(
      (changes[0].snapshot as { agentRunningFilter: boolean })
        .agentRunningFilter,
    ).toBe(true);
  });

  it("Reset outside a view still turns it off (clearFilters owns the field)", () => {
    const changes: Array<Record<string, unknown>> = [];
    const actions = {
      resetFiltersTo: () => changes.push({ toView: true }),
      clearFilters: () => changes.push({ cleared: true }),
      setDateFilter: () => {},
    };

    applyFilterReset(null, actions as never);
    expect(changes).toEqual([{ cleared: true }]);

    // …and the real store action actually zeroes the field.
    const store = makeStore();
    store.getState().toggleWorkingOnly();
    store.getState().clearFilters();
    expect(store.getState().workingOnly).toBe(false);
  });
});

describe("the 'view is modified' dot sees the condition", () => {
  const slice = (workingOnly: boolean) => ({
    ...defaultIssueFilterSlice(),
    workingOnly,
    swimlaneGrouping: "assignee" as const,
    tableColumns: ["title"],
    tableColumnWidths: {},
    tableGrouping: "none" as const,
  });

  it("a view saved with it, live filter off → modified", () => {
    expect(
      viewMatchesSlice(
        { query: { agentRunningFilter: true }, display: {} },
        slice(false) as never,
        "list",
      ),
    ).toBe(false);
  });

  it("matching states → not modified", () => {
    expect(
      viewMatchesSlice(
        { query: { agentRunningFilter: true }, display: {} },
        slice(true) as never,
        "list",
      ),
    ).toBe(true);
  });

  it("a pre-key view fixes it OFF, so turning it on is a modification", () => {
    // A view saved before upstream added the field carries no key. Web seeds
    // it from the store default — `mergeViewStatePersisted` keeps `false` —
    // so the seed definition fixes `false` and the comparison is
    // `false !== true` → modified (upstream `definition.test.ts`'s "treats a
    // view saved before the filter existed as off"). Mobile reads the raw
    // blob instead of a seed, and its `sanitizeViewQuery` defaults the same
    // way, so the two clients agree on this without a special case.
    expect(
      viewMatchesSlice({ query: {}, display: {} }, slice(true) as never, "list"),
    ).toBe(false);
    // ...and a pre-key view with the filter off matches, which is the case
    // that must NOT light the dot for every legacy view.
    expect(
      viewMatchesSlice({ query: {}, display: {} }, slice(false) as never, "list"),
    ).toBe(true);
  });
});
