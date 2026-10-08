/**
 * Tests for the server facet-count bridge (iter211).
 *
 * The interesting cases are the *keys*: the server answers every dimension
 * with a flat `key → count` list whose key vocabulary is its own
 * (`__none__` for unset assignee/project, `member:<uuid>` for actors, a label
 * id, an option id). The filter UI looks counts up by its own key shapes, so
 * this module is the single place those two vocabularies are reconciled —
 * exactly the role `issue-table-group-counts.ts` plays for group headers.
 *
 * The disjunctive semantics are the reason this exists at all: the server
 * drops the facet's OWN dimension before counting, so a count answers "how
 * many issues would I see if I turned this option on", independent of what is
 * already selected. A test pins that the built spec keeps every OTHER
 * dimension and lets the server own the drop.
 */
import { describe, expect, it } from "vitest";
import type {
  IssueTableFacet,
  IssueTableFacetsResponse,
} from "@multica/core/types";
import {
  FACET_DIMENSIONS,
  NO_VALUE_KEY,
  buildIssueFacetQuerySpec,
  facetCountsByDimension,
  facetScopeFor,
  facetValuesFor,
  propertyFacetable,
} from "./issue-facet-counts";
import { myIssueTableScope, workspaceIssueTableScope } from "./issue-table-group-counts";

function response(...facets: IssueTableFacet[]): IssueTableFacetsResponse {
  return { query_fingerprint: "fp", total: 0, facets };
}

describe("FACET_DIMENSIONS", () => {
  it("asks for every dimension the filter panel renders a count next to", () => {
    // Web renders a count on status, priority, assignee, creator, project and
    // label (issues-header.tsx:1266/1309/387/1402/1429/626). A dimension
    // missing here silently renders no badge.
    expect([...FACET_DIMENSIONS]).toEqual([
      { kind: "status" },
      { kind: "priority" },
      { kind: "assignee" },
      { kind: "creator" },
      { kind: "project" },
      { kind: "label" },
    ]);
  });

  it("does not request a facet the server rejects or that has no count surface", () => {
    // `property` facets are added per definition by the caller, and
    // `working_agents` has no per-option badge on mobile's filter sheet, so
    // neither belongs in the always-on list.
    const kinds = FACET_DIMENSIONS.map((f) => f.kind);
    expect(kinds).not.toContain("working_agents");
    expect(kinds).not.toContain("property");
  });
});

describe("buildIssueFacetQuerySpec", () => {
  it("projects the list window onto the table query spec", () => {
    const spec = buildIssueFacetQuerySpec(workspaceIssueTableScope("all"), {
      statuses: ["todo"],
      priorities: ["high"],
      label_ids: ["l1"],
      sort_by: "created_at",
      sort_direction: "desc",
    });
    expect(spec.scope).toEqual({ kind: "workspace" });
    expect(spec.filters).toEqual({
      statuses: ["todo"],
      priorities: ["high"],
      label_ids: ["l1"],
      include_sub_issues: true,
    });
  });

  it("keeps the facet's own dimension in the request", () => {
    // Disjunction is the SERVER's job (`issueTableQueryWithoutFacet` drops
    // the facet's own dimension before counting). Pre-dropping it client-side
    // would make the count answer a different question than web's.
    const spec = buildIssueFacetQuerySpec(workspaceIssueTableScope("all"), {
      statuses: ["todo", "in_progress"],
    });
    expect(spec.filters.statuses).toEqual(["todo", "in_progress"]);
  });

  it("drops sort, which facets cannot depend on", () => {
    const spec = buildIssueFacetQuerySpec(workspaceIssueTableScope("all"), {
      sort_by: "priority",
      sort_direction: "asc",
    });
    expect(spec.sort).toEqual({ field: "position", direction: "asc" });
  });

  it("carries the date band and the no-value toggles", () => {
    const spec = buildIssueFacetQuerySpec(myIssueTableScope("assigned"), {
      include_no_assignee: true,
      include_no_project: true,
      date_field: "created_at",
      date_start: "2026-01-01T00:00:00.000Z",
      date_end: "2026-02-01T00:00:00.000Z",
    });
    expect(spec.scope).toEqual({ kind: "my", relation: "assigned" });
    expect(spec.filters.include_no_assignee).toBe(true);
    expect(spec.filters.include_no_project).toBe(true);
    expect(spec.filters.date).toEqual({
      field: "created_at",
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-02-01T00:00:00.000Z",
    });
  });

  it("carries a half-open date band as no date filter at all", () => {
    // A start without an end is not a band the server accepts; sending one
    // would narrow the count by a field the list is not narrowing by.
    const spec = buildIssueFacetQuerySpec(workspaceIssueTableScope("all"), {
      date_field: "created_at",
      date_start: "2026-01-01T00:00:00.000Z",
    });
    expect(spec.filters.date).toBeUndefined();
  });

  it("omits empty dimensions instead of sending empty arrays", () => {
    const spec = buildIssueFacetQuerySpec(workspaceIssueTableScope("all"), {
      statuses: [],
      label_ids: [],
    });
    expect(spec.filters.statuses).toBeUndefined();
    expect(spec.filters.label_ids).toBeUndefined();
  });
});

describe("facetCountsByDimension", () => {
  it("keeps the server's own key vocabulary per dimension", () => {
    const counts = facetCountsByDimension(
      response(
        {
          kind: "status",
          values: [
            { key: "todo", count: 12 },
            { key: "done", count: 30 },
          ],
        },
        {
          kind: "assignee",
          values: [
            { key: "member:u1", count: 4 },
            { key: NO_VALUE_KEY, count: 7 },
          ],
        },
      ),
    );
    expect(counts.status.get("todo")).toBe(12);
    expect(counts.status.get("done")).toBe(30);
    expect(counts.assignee.get("member:u1")).toBe(4);
    expect(counts.assignee.get(NO_VALUE_KEY)).toBe(7);
    // A dimension the server did not answer keeps an empty map rather than
    // undefined, so callers never branch on presence.
    expect(counts.priority.size).toBe(0);
    expect(counts.label.size).toBe(0);
  });

  it("keys property facets by definition id", () => {
    const counts = facetCountsByDimension(
      response(
        {
          kind: "property",
          property_id: "p1",
          values: [{ key: "opt-a", count: 3 }],
        },
        {
          kind: "property",
          property_id: "p2",
          values: [{ key: "true", count: 9 }],
        },
      ),
    );
    expect(counts.property.get("p1")?.get("opt-a")).toBe(3);
    expect(counts.property.get("p2")?.get("true")).toBe(9);
  });

  it("takes the last value for a repeated key rather than summing", () => {
    // The server groups by value, so a repeated key is a malformed response.
    // Summing would invent a number that matches neither response; the last
    // wins, which is at least a value the server actually sent.
    const counts = facetCountsByDimension(
      response({
        kind: "status",
        values: [
          { key: "todo", count: 1 },
          { key: "todo", count: 5 },
        ],
      }),
    );
    expect(counts.status.get("todo")).toBe(5);
  });

  it("survives an empty response", () => {
    const counts = facetCountsByDimension(response());
    expect(counts.status.size).toBe(0);
    expect(counts.property.size).toBe(0);
  });
});

describe("facetValuesFor", () => {
  it("returns the per-dimension map, or undefined while unresolved", () => {
    const counts = facetCountsByDimension(
      response({ kind: "label", values: [{ key: "l1", count: 2 }] }),
    );
    expect(facetValuesFor(counts, { kind: "label" })?.get("l1")).toBe(2);
    // Unresolved (request in flight or failed) is `undefined`, never an empty
    // map: the UI must render NO badge at all rather than "0 issues".
    expect(facetValuesFor(undefined, { kind: "label" })).toBeUndefined();
  });

  it("resolves a property facet by its definition id", () => {
    const counts = facetCountsByDimension(
      response({
        kind: "property",
        property_id: "p1",
        values: [{ key: "opt-a", count: 3 }],
      }),
    );
    expect(
      facetValuesFor(counts, { kind: "property", property_id: "p1" })?.get("opt-a"),
    ).toBe(3);
    // A definition the response does not cover has no counts of its own.
    expect(
      facetValuesFor(counts, { kind: "property", property_id: "p9" }),
    ).toBeUndefined();
  });

  it("does not confuse two property facets", () => {
    const counts = facetCountsByDimension(
      response(
        {
          kind: "property",
          property_id: "p1",
          values: [{ key: "shared", count: 3 }],
        },
        {
          kind: "property",
          property_id: "p2",
          values: [{ key: "shared", count: 8 }],
        },
      ),
    );
    expect(
      facetValuesFor(counts, { kind: "property", property_id: "p2" })?.get("shared"),
    ).toBe(8);
  });
});

describe("facetScopeFor", () => {
  it("maps the workspace Issues tabs onto their Table scopes", () => {
    // The `members` / `agents` tabs are a client-side assignee_type predicate on
    // the list, and a server-side `assignee_types` on the Table; the count must
    // be evaluated the same way or the badge counts rows the tab hides.
    expect(facetScopeFor("all", "all")).toEqual({ kind: "workspace" });
    expect(facetScopeFor("all", "members")).toEqual({
      kind: "workspace",
      assignee_types: ["member"],
    });
    expect(facetScopeFor("all", "agents")).toEqual({
      kind: "workspace",
      assignee_types: ["agent", "squad"],
    });
  });

  it("maps the My Issues tabs onto their Table relations", () => {
    expect(facetScopeFor("my", "assigned")).toEqual({
      kind: "my",
      relation: "assigned",
    });
    expect(facetScopeFor("my", "created")).toEqual({
      kind: "my",
      relation: "created",
    });
    // `agents` is the involved relation — mobile's naming, web's semantics.
    expect(facetScopeFor("my", "agents")).toEqual({
      kind: "my",
      relation: "involved",
    });
    // `all` scatters the three legs on the list API; the Table has a real
    // union, which is what the facet has to count.
    expect(facetScopeFor("my", "all")).toEqual({
      kind: "my",
      relation: "any",
    });
  });

  it("falls back to the surface's default tab for an unknown one", () => {
    // A route param is a string from the URL, so an unrecognized value must
    // land on the same default the store uses, never on an invalid scope.
    expect(facetScopeFor("my", undefined)).toEqual({
      kind: "my",
      relation: "assigned",
    });
    expect(facetScopeFor("all", "nonsense")).toEqual({ kind: "workspace" });
  });

  it("counts a project surface only when it knows which project", () => {
    expect(facetScopeFor("project", "all", "proj-1")).toEqual({
      kind: "project",
      project_id: "proj-1",
    });
    expect(facetScopeFor("project", "members", "proj-1")).toEqual({
      kind: "project",
      project_id: "proj-1",
      assignee_types: ["member"],
    });
    // Without the id there is no honest scope: `{kind: "workspace"}` would
    // badge every option with a count from other projects. None is correct.
    expect(facetScopeFor("project", "all")).toBeNull();
    expect(facetScopeFor("project", "all", null)).toBeNull();
  });
});

describe("propertyFacetable", () => {
  it("accepts only the three types the server can facet", () => {
    // issue_table_facets.go:236-247 answers select / multi_select / checkbox.
    expect(propertyFacetable("select")).toBe(true);
    expect(propertyFacetable("multi_select")).toBe(true);
    expect(propertyFacetable("checkbox")).toBe(true);
  });

  it("rejects the types the server answers with property_type_unsupported", () => {
    // A rejection fails the whole batch, taking the six base dimensions'
    // badges down with it — so these must never be requested.
    expect(propertyFacetable("actor")).toBe(false);
    expect(propertyFacetable("multi_actor")).toBe(false);
    expect(propertyFacetable("text")).toBe(false);
    expect(propertyFacetable("number")).toBe(false);
    expect(propertyFacetable("date")).toBe(false);
    expect(propertyFacetable("url")).toBe(false);
    expect(propertyFacetable(undefined)).toBe(false);
    // A type a newer server adds is not facetable until this build knows how
    // to read its values either.
    expect(propertyFacetable("multi_text")).toBe(false);
  });
});
