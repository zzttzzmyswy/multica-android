/**
 * View-mode behavior for the two issue-list view stores (MYS-409 board).
 *
 * The `view` field is a display preference: it must survive `clearFilters`
 * (web keeps viewMode outside the filter slice), and it must not be reset
 * by `clearFilterDimension`.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { useIssuesViewStore } from "./issues-view-store";
import { useMyIssuesViewStore } from "./my-issues-view-store";

describe("useIssuesViewStore view mode", () => {
  beforeEach(() => {
    // Reset to store defaults before each case.
    useIssuesViewStore.setState({
      view: "list",
      scope: "all",
      statusFilters: [],
      priorityFilters: [],
      assigneeFilters: [],
      includeNoAssignee: false,
      creatorFilters: [],
      projectFilters: [],
      includeNoProject: false,
      labelFilters: [],
      sortBy: "position",
      sortDirection: "asc",
      grouping: "status",
    });
  });

  it("defaults to list view", () => {
    expect(useIssuesViewStore.getState().view).toBe("list");
  });

  it("setView switches the mode", () => {
    useIssuesViewStore.getState().setView("board");
    expect(useIssuesViewStore.getState().view).toBe("board");
    useIssuesViewStore.getState().setView("list");
    expect(useIssuesViewStore.getState().view).toBe("list");
  });

  it("clearFilters does not reset the view", () => {
    useIssuesViewStore.getState().setView("board");
    useIssuesViewStore.getState().toggleStatusFilter("todo");
    useIssuesViewStore.getState().clearFilters();
    expect(useIssuesViewStore.getState().view).toBe("board");
    expect(useIssuesViewStore.getState().statusFilters).toEqual([]);
  });

  it("changing scope or grouping does not touch the view", () => {
    useIssuesViewStore.getState().setView("board");
    useIssuesViewStore.getState().setScope("members");
    useIssuesViewStore.getState().setGrouping("assignee");
    expect(useIssuesViewStore.getState().view).toBe("board");
  });
});

describe("useMyIssuesViewStore view mode", () => {
  beforeEach(() => {
    useMyIssuesViewStore.setState({
      view: "list",
      scope: "assigned",
      statusFilters: [],
      priorityFilters: [],
      assigneeFilters: [],
      includeNoAssignee: false,
      creatorFilters: [],
      projectFilters: [],
      includeNoProject: false,
      labelFilters: [],
      sortBy: "position",
      sortDirection: "asc",
      grouping: "status",
    });
  });

  it("defaults to list view and switches via setView", () => {
    expect(useMyIssuesViewStore.getState().view).toBe("list");
    useMyIssuesViewStore.getState().setView("board");
    expect(useMyIssuesViewStore.getState().view).toBe("board");
  });

  it("clearFilterDimension does not reset the view", () => {
    useMyIssuesViewStore.getState().setView("board");
    useMyIssuesViewStore.getState().toggleStatusFilter("done");
    useMyIssuesViewStore.getState().clearFilterDimension("status");
    expect(useMyIssuesViewStore.getState().view).toBe("board");
  });
});