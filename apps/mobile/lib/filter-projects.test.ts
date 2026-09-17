import { describe, expect, it } from "vitest";
import type { Project } from "@multica/core/types";
import {
  countActiveProjectFilters,
  EMPTY_PROJECT_FILTERS,
  filterProjects,
  nextProjectSort,
  PROJECT_PRIORITY_SORT_ORDER,
  PROJECT_SORT_DEFAULT_DIRECTION,
  PROJECT_STATUS_SORT_ORDER,
  sortProjects,
  toggleInList,
  type ProjectListFilters,
  type ProjectSortField,
} from "./filter-projects";

function project(overrides: Partial<Project>): Project {
  return {
    id: "p",
    workspace_id: "ws",
    title: "Project",
    description: null,
    icon: null,
    status: "planned",
    priority: "none",
    lead_type: null,
    lead_id: null,
    start_date: null,
    due_date: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    issue_count: 0,
    done_count: 0,
    resource_count: 0,
    ...overrides,
  } as Project;
}

const list = [
  project({ id: "a", title: "Alpha", status: "in_progress", priority: "high", created_at: "2026-01-03T00:00:00Z", issue_count: 4, done_count: 1 }),
  project({ id: "b", title: "beta", status: "planned", priority: "urgent", created_at: "2026-01-01T00:00:00Z", issue_count: 0 }),
  project({ id: "c", title: "Gamma", status: "completed", priority: "low", created_at: "2026-01-02T00:00:00Z", issue_count: 2, done_count: 2 }),
];

describe("filterProjects", () => {
  it("returns everything when no filters are active", () => {
    expect(filterProjects(list, "", EMPTY_PROJECT_FILTERS)).toHaveLength(3);
  });

  it("matches title case-insensitively", () => {
    expect(filterProjects(list, "ALPH", EMPTY_PROJECT_FILTERS).map((p) => p.id)).toEqual(["a"]);
    expect(filterProjects(list, "gamma", EMPTY_PROJECT_FILTERS).map((p) => p.id)).toEqual(["c"]);
  });

  it("trims the query before matching", () => {
    expect(filterProjects(list, "  beta  ", EMPTY_PROJECT_FILTERS)).toHaveLength(1);
  });

  it("empty query keeps all rows", () => {
    expect(filterProjects(list, "   ", EMPTY_PROJECT_FILTERS)).toHaveLength(3);
  });

  it("filters by status", () => {
    const filters: ProjectListFilters = { statuses: ["planned"], priorities: [], leads: [] };
    expect(filterProjects(list, "", filters).map((p) => p.id)).toEqual(["b"]);
  });

  it("filters by priority", () => {
    const filters: ProjectListFilters = { statuses: [], priorities: ["urgent", "low"], leads: [] };
    expect(filterProjects(list, "", filters).map((p) => p.id)).toEqual(["b", "c"]);
  });

  it("filters by composite lead ref", () => {
    const withLead = [
      project({ id: "a", lead_type: "member", lead_id: "m1" }),
      project({ id: "b", lead_type: "agent", lead_id: "ag1" }),
      project({ id: "c" }),
    ];
    const filters: ProjectListFilters = { statuses: [], priorities: [], leads: ["member:m1"] };
    expect(filterProjects(withLead, "", filters).map((p) => p.id)).toEqual(["a"]);
  });

  it("a project without a lead is excluded when a lead filter is active", () => {
    const filters: ProjectListFilters = { statuses: [], priorities: [], leads: ["member:m1"] };
    expect(filterProjects(list, "", filters)).toHaveLength(0);
  });

  it("combines search + status + priority (AND)", () => {
    const filters: ProjectListFilters = { statuses: ["in_progress"], priorities: ["high"], leads: [] };
    expect(filterProjects(list, "alp", filters)).toHaveLength(1);
    expect(filterProjects(list, "gam", filters)).toHaveLength(0);
  });
});

describe("sortProjects", () => {
  it("sorts by name asc (case-insensitive) by default direction", () => {
    const sorted = sortProjects(list, "name", PROJECT_SORT_DEFAULT_DIRECTION.name);
    expect(sorted.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("name desc reverses the order", () => {
    const sorted = sortProjects(list, "name", "desc");
    expect(sorted.map((p) => p.id)).toEqual(["c", "b", "a"]);
  });

  it("sorts by priority desc with title tiebreak", () => {
    const sorted = sortProjects(list, "priority", "desc");
    expect(sorted.map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts by status using the web status order", () => {
    const sorted = sortProjects(list, "status", "asc");
    expect(sorted.map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts by progress with no-issue projects last", () => {
    const sorted = sortProjects(list, "progress", "desc");
    expect(sorted.map((p) => p.id)).toEqual(["c", "a", "b"]);
  });

  it("sorts by created date", () => {
    const sorted = sortProjects(list, "created", "desc");
    expect(sorted.map((p) => p.id)).toEqual(["a", "c", "b"]);
  });

  it("does not mutate the input array", () => {
    const snapshot = [...list];
    sortProjects(list, "name", "asc");
    expect(list).toEqual(snapshot);
  });
});

describe("countActiveProjectFilters", () => {
  it("counts each non-empty dimension once", () => {
    expect(countActiveProjectFilters(EMPTY_PROJECT_FILTERS)).toBe(0);
    expect(
      countActiveProjectFilters({ statuses: ["planned"], priorities: [], leads: [] }),
    ).toBe(1);
    expect(
      countActiveProjectFilters({
        statuses: ["planned", "paused"],
        priorities: ["high"],
        leads: ["member:1"],
      }),
    ).toBe(3);
  });
});

describe("toggleInList", () => {
  it("adds a missing value", () => {
    expect(toggleInList(["a"], "b")).toEqual(["a", "b"]);
  });

  it("removes a present value", () => {
    expect(toggleInList(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("sort order maps match web", () => {
  it("priority order: urgent > high > medium > low > none", () => {
    expect(PROJECT_PRIORITY_SORT_ORDER).toEqual({ urgent: 4, high: 3, medium: 2, low: 1, none: 0 });
  });

  it("status order: planned < in_progress < paused < completed < cancelled", () => {
    expect(PROJECT_STATUS_SORT_ORDER).toEqual({
      planned: 0,
      in_progress: 1,
      paused: 2,
      completed: 3,
      cancelled: 4,
    });
  });

  it("default directions match the web view store", () => {
    expect(PROJECT_SORT_DEFAULT_DIRECTION).toEqual({
      name: "asc",
      priority: "desc",
      status: "asc",
      progress: "desc",
      created: "desc",
    });
  });
});

describe("sort fields", () => {
  const fields: ProjectSortField[] = ["name", "priority", "status", "progress", "created"];
  it.each(fields)("supports %s without throwing", (field) => {
    expect(() =>
      sortProjects(list, field, PROJECT_SORT_DEFAULT_DIRECTION[field]),
    ).not.toThrow();
  });
});

// The compact table's header tap (iteration 135). Same contract as the issue
// table's `nextTableSort`: a NEW column applies its default direction, the
// ACTIVE column flips. Two directions are the only targets either way; the
// tap-to-cycle is the touch adaptation of web's two explicit menu options.
describe("nextProjectSort", () => {
  it("applies the field's default direction when the column is new", () => {
    expect(nextProjectSort("created", "desc", "priority")).toEqual({
      field: "priority",
      direction: "desc",
    });
    expect(nextProjectSort("priority", "desc", "name")).toEqual({
      field: "name",
      direction: "asc",
    });
  });

  it("flips the direction when the column is already active", () => {
    expect(nextProjectSort("progress", "desc", "progress")).toEqual({
      field: "progress",
      direction: "asc",
    });
    expect(nextProjectSort("progress", "asc", "progress")).toEqual({
      field: "progress",
      direction: "desc",
    });
  });

  it("flips relative to the CURRENT direction, not the field's default", () => {
    // `created` defaults to desc; having been flipped to asc, the next tap
    // must return to desc rather than re-applying the default (which would
    // leave the header inert on every other tap).
    const first = nextProjectSort("created", "desc", "created");
    expect(first.direction).toBe("asc");
    const second = nextProjectSort("created", first.direction, "created");
    expect(second.direction).toBe("desc");
  });
});
