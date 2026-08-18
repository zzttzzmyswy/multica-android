/**
 * Project-scope issue view store (MYS-437).
 *
 * The project surface must be isolated from the workspace-wide and My
 * Issues surfaces: a filter / scope tab / view-mode change on the project
 * page must never leak into the other two, and vice versa. The three
 * stores are module singletons, so the tests exercise the real objects the
 * three surfaces share.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectIssuesViewStore } from "./project-issues-view-store";
import { useIssuesViewStore } from "./issues-view-store";
import { useMyIssuesViewStore } from "./my-issues-view-store";
import { defaultIssueFilterSlice, type IssueFilterSlice } from "./issue-filter-slice";

type Store = ReturnType<typeof useProjectIssuesViewStore.getState>;

/** Reset every participating store to its slice defaults (scope/view preserved). */
function resetSlice(s: Store) {
  useProjectIssuesViewStore.setState({
    ...defaultIssueFilterSlice(),
    scope: "all",
    view: "list",
  });
  useIssuesViewStore.setState({ ...defaultIssueFilterSlice(), scope: "all", view: "list" });
  useMyIssuesViewStore.setState({ ...defaultIssueFilterSlice(), scope: "assigned", view: "list" });
}

describe("useProjectIssuesViewStore", () => {
  beforeEach(resetSlice);

  it("shares the filter slice shape with the other view stores", () => {
    const s: IssueFilterSlice = useProjectIssuesViewStore.getState();
    expect(s.statusFilters).toEqual([]);
    expect(s.sortBy).toBe("position");
    expect(s.grouping).toBe("status");
    expect(typeof s.toggleStatusFilter).toBe("function");
    expect(typeof s.resetFiltersTo).toBe("function");
  });

  it("defaults to the all tab in list view", () => {
    expect(useProjectIssuesViewStore.getState().scope).toBe("all");
    expect(useProjectIssuesViewStore.getState().view).toBe("list");
  });

  it("is isolated from the workspace-wide store", () => {
    useProjectIssuesViewStore.getState().toggleStatusFilter("todo");
    useProjectIssuesViewStore.getState().setScope("members");
    useProjectIssuesViewStore.getState().setView("board");
    expect(useIssuesViewStore.getState().statusFilters).toEqual([]);
    expect(useIssuesViewStore.getState().scope).toBe("all");
    expect(useIssuesViewStore.getState().view).toBe("list");
  });

  it("is isolated from the My Issues store", () => {
    useProjectIssuesViewStore.getState().toggleAssigneeFilter({
      type: "member",
      id: "u-1",
    });
    useMyIssuesViewStore.getState().togglePriorityFilter("high");
    expect(useProjectIssuesViewStore.getState().assigneeFilters).toEqual([
      { type: "member", id: "u-1" },
    ]);
    expect(useProjectIssuesViewStore.getState().priorityFilters).toEqual([]);
    expect(useMyIssuesViewStore.getState().statusFilters).toEqual([]);
  });

  it("clearFilters does not reset the view or tab (display layers stay)", () => {
    useProjectIssuesViewStore.getState().setView("board");
    useProjectIssuesViewStore.getState().setScope("agents");
    useProjectIssuesViewStore.getState().toggleStatusFilter("done");
    useProjectIssuesViewStore.getState().clearFilters();
    expect(useProjectIssuesViewStore.getState().view).toBe("board");
    expect(useProjectIssuesViewStore.getState().scope).toBe("agents");
    expect(useProjectIssuesViewStore.getState().statusFilters).toEqual([]);
  });

  it("setScope / setView round-trip", () => {
    useProjectIssuesViewStore.getState().setView("board");
    useProjectIssuesViewStore.getState().setScope("members");
    expect(useProjectIssuesViewStore.getState().view).toBe("board");
    expect(useProjectIssuesViewStore.getState().scope).toBe("members");
  });
});