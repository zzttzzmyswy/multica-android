/**
 * Iteration 211 — wiring ratchet for the filter-panel facet counts.
 *
 * The mobile vitest lane is Node-only: no RN renderer, so a green
 * `facetValuesFor` proves nothing about whether any screen consults it. That
 * is exactly where this class of defect hid for 210 iterations — the endpoint
 * existed, the web client used it, and the mobile filter panel rendered no
 * count at all.
 *
 * Each assertion corresponds to one surface that must show a count. Dropping
 * any one of them silently removes a number web shows.
 *
 * Comments are stripped before matching so a comment that merely describes a
 * branch cannot satisfy an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

/** Source with comments removed — an assertion must match real code. */
function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("the filter panel asks the server for facet counts", () => {
  const panel = code("app/(app)/[workspace]/issues-filter.tsx");

  it("resolves counts through the shared sheet hook", () => {
    expect(panel).toContain("useFilterSheetFacetCounts");
  });

  it("badges status and priority options, not merely computes their counts", () => {
    // Both halves matter: the count must be READ (countFor) and RENDERED
    // (<OptionCount>). Asserting only the computation let a badge be deleted
    // while the suite stayed green — the exact hole this ratchet exists for.
    expect(panel).toContain('countFor({ kind: "status" }, option.key)');
    expect(panel).toContain('countFor({ kind: "priority" }, priority)');
    const statusRow = panel.slice(
      panel.indexOf('countFor({ kind: "status" }, option.key)'),
    );
    expect(statusRow.slice(0, 1200)).toContain("<OptionCount");
    const priorityRow = panel.slice(
      panel.indexOf('countFor({ kind: "priority" }, priority)'),
    );
    expect(priorityRow.slice(0, 1200)).toContain("<OptionCount");
  });

  it("badges the unassigned / no-project toggles", () => {
    // Web badges these two rows like any option (issues-header.tsx:377), and
    // the server answers them under the `__none__` key.
    expect(panel).toContain('count={countFor({ kind: "assignee" }, NO_VALUE_KEY)}');
    expect(panel).toContain('count={countFor({ kind: "project" }, NO_VALUE_KEY)}');
  });

  it("asks only for property types the server can facet", () => {
    // An actor property would 400 the whole batch and cost the six base
    // dimensions their badges too — see `propertyFacetable`.
    expect(panel).toContain("propertyFacetable");
  });

  it("forwards the project id into the query, not merely reads the param", () => {
    // Reading the route param proves nothing; it has to reach the hook, or a
    // project sheet silently falls back to no counts (a badge-free panel) —
    // which is exactly the bug this assertion caught during iteration 211.
    expect(panel).toContain("projectId: projectIdParam");
  });
});

describe("every filter picker body renders the badge", () => {
  const bodies = code("components/issue/pickers/filter-picker-bodies.tsx");

  it("has one shared badge component with the zero/unknown rule", () => {
    expect(bodies).toContain("function OptionCountBadge");
    // Web's `count > 0 &&` guard, plus `undefined` for "not known yet".
    expect(bodies).toMatch(/count === undefined \|\| count <= 0/);
  });

  it("badges actor rows", () => {
    // The lookup and the render must both be present: a body can compute a
    // count and still not draw it.
    expect(bodies).toContain(
      '<OptionCountBadge count={counts?.get(`${value.type}:${value.id}`)} />',
    );
  });

  it("badges project rows and the no-project row", () => {
    expect(bodies).toContain(
      "<OptionCountBadge count={counts?.get(item.project.id)} />",
    );
    expect(bodies).toContain(
      "<OptionCountBadge count={counts?.get(NO_VALUE_KEY)} />",
    );
  });

  it("badges label rows", () => {
    const label = bodies.slice(
      bodies.indexOf("FilterLabelPickerBody"),
      bodies.indexOf("FilterPropertyPickerBody"),
    );
    expect(label).toContain("<OptionCountBadge count={counts?.get(item.id)} />");
  });

  it("badges custom-property option rows", () => {
    const property = bodies.slice(bodies.indexOf("FilterPropertyPickerBody"));
    expect(property).toContain("<OptionCountBadge count={counts?.get(item.id)} />");
  });
});

describe("the picker route hands the bodies their counts", () => {
  const picker = code("app/(app)/[workspace]/issues-filter-picker.tsx");

  it("computes counts through the same shared hook as the panel", () => {
    expect(picker).toContain("useFilterSheetFacetCounts");
  });

  it("resolves each body's dimension by kind", () => {
    expect(picker).toContain('facetValuesFor(facetCounts, { kind: "assignee" })');
    expect(picker).toContain('facetValuesFor(facetCounts, { kind: "creator" })');
    expect(picker).toContain('facetValuesFor(facetCounts, { kind: "project" })');
    expect(picker).toContain('facetValuesFor(facetCounts, { kind: "label" })');
  });

  it("hands each dimension's counts to its body", () => {
    // Resolution without a `counts=` prop reaches no row.
    expect(picker).toMatch(/counts=\{\s*resolvedDim === "assignee"/);
    expect(picker).toContain('counts={facetValuesFor(facetCounts, { kind: "project" })}');
    expect(picker).toContain('counts={facetValuesFor(facetCounts, { kind: "label" })}');
  });
});

describe("the project surface routes its identity through to the counts", () => {
  const surface = code("components/project/project-issue-surface.tsx");
  const panel = code("app/(app)/[workspace]/issues-filter.tsx");

  it("sends the project id when it opens the filter sheet", () => {
    // Without it the project sheet counts nothing at all — the correct
    // fallback, but a silent loss of every badge on that surface.
    expect(surface).toContain('scope: "project", project: projectId');
  });

  it("the panel carries the id on to the sub-picker", () => {
    // The dimension row and its options must agree; a panel-only id leaves
    // the option rows badge-less.
    expect(panel).toContain("project: projectIdParam");
  });
});

describe("the api client exposes the facets endpoint", () => {
  const api = code("data/api.ts");

  it("posts to /api/issues/table/facets", () => {
    expect(api).toContain('"/api/issues/table/facets"');
    expect(api).toContain("listIssueTableFacets");
  });
});
