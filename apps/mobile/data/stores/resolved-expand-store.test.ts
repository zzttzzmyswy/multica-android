/**
 * The resolved-thread expand store — the mobile port of web's
 * `packages/core/issues/stores/resolved-expand-store.ts`.
 *
 * Mobile kept this state inside `CommentCard`'s `useState` until iteration 228.
 * The reason it moved is the reason these tests exist: search's
 * fold/unfold-all-comments rows drive it from OUTSIDE the issue page, which
 * component state cannot do. A store that silently dropped a write, or that
 * handed back a fresh set each read (re-render loop — see apps/mobile/CLAUDE.md
 * "Common Zustand footguns"), would still look correct on screen.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  selectExpandedResolved,
  useResolvedExpandStore,
} from "./resolved-expand-store";

const state = () => useResolvedExpandStore.getState();

beforeEach(() => {
  useResolvedExpandStore.setState({ expandedByIssue: {} });
});

describe("setExpanded", () => {
  it("expands and folds one thread", () => {
    state().setExpanded("issue-1", "c1", true);
    expect(state().expandedByIssue["issue-1"]?.has("c1")).toBe(true);

    state().setExpanded("issue-1", "c1", false);
    // A fully-folded issue leaves no entry behind, matching web.
    expect(state().expandedByIssue["issue-1"]).toBeUndefined();
  });

  it("keeps unrelated threads of the same issue", () => {
    state().setExpanded("issue-1", "c1", true);
    state().setExpanded("issue-1", "c2", true);
    state().setExpanded("issue-1", "c1", false);
    expect([...(state().expandedByIssue["issue-1"] ?? [])]).toEqual(["c2"]);
  });

  it("keeps issues independent", () => {
    state().setExpanded("issue-1", "c1", true);
    state().setExpanded("issue-2", "c1", true);
    state().setExpanded("issue-1", "c1", false);
    expect(state().expandedByIssue["issue-1"]).toBeUndefined();
    expect(state().expandedByIssue["issue-2"]?.has("c1")).toBe(true);
  });

  it("returns the SAME state object for a no-op write", () => {
    // Web's own early return. Without it every render that re-affirms the
    // current value would notify subscribers — a re-render loop on a list of
    // comment cards.
    state().setExpanded("issue-1", "c1", true);
    const before = state();
    state().setExpanded("issue-1", "c1", true);
    expect(state()).toBe(before);
  });
});

describe("expandAll / collapseAll", () => {
  it("expands every given root at once", () => {
    state().expandAll("issue-1", ["c1", "c2", "c3"]);
    expect([...(state().expandedByIssue["issue-1"] ?? [])].sort()).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
  });

  it("adds to what is already expanded rather than replacing it", () => {
    state().setExpanded("issue-1", "c0", true);
    state().expandAll("issue-1", ["c1"]);
    expect([...(state().expandedByIssue["issue-1"] ?? [])].sort()).toEqual([
      "c0",
      "c1",
    ]);
  });

  it("is a no-op for an empty id list, keeping state identity", () => {
    state().expandAll("issue-1", ["c1"]);
    const before = state();
    state().expandAll("issue-1", []);
    expect(state()).toBe(before);
  });

  it("collapseAll folds every thread of that issue only", () => {
    state().expandAll("issue-1", ["c1", "c2"]);
    state().expandAll("issue-2", ["c9"]);
    state().collapseAll("issue-1");
    expect(state().expandedByIssue["issue-1"]).toBeUndefined();
    expect(state().expandedByIssue["issue-2"]?.has("c9")).toBe(true);
  });

  it("collapseAll on an untouched issue keeps state identity", () => {
    const before = state();
    state().collapseAll("issue-never-seen");
    expect(state()).toBe(before);
  });
});

describe("selectExpandedResolved", () => {
  it("returns a STABLE empty set for an unknown or null issue", () => {
    // A selector that built `new Set()` per call would spin
    // useSyncExternalStore forever; the reference must be shared.
    const a = selectExpandedResolved("nope")(state());
    const b = selectExpandedResolved("nope")(state());
    expect(a).toBe(b);
    expect(selectExpandedResolved(null)(state())).toBe(a);
    expect(a.size).toBe(0);
  });

  it("returns the issue's own set once one exists", () => {
    state().expandAll("issue-1", ["c1"]);
    const set = selectExpandedResolved("issue-1")(state());
    expect(set.has("c1")).toBe(true);
    // Same reference across reads — no per-call allocation.
    expect(selectExpandedResolved("issue-1")(state())).toBe(set);
  });
});
