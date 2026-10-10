/**
 * Iteration 220 (MYS-2056) — wiring ratchet for SCALAR custom-property
 * filtering.
 *
 * The mobile vitest lane is Node-only: it has no RN renderer, so a green pure
 * function proves nothing about whether a screen actually calls it. That gap
 * is exactly where this round's defect lived — the matcher could be perfect
 * while `issues-filter.tsx` still filtered the scalar definitions out before
 * they ever reached a row, which is what "text/number/date/url are not
 * filterable on the phone" meant in practice.
 *
 * Each assertion below corresponds to one link in the chain. Dropping any one
 * of them silently re-breaks the feature:
 *
 *   filter panel  → the scalar definition must not be filtered out
 *   facet request → it must be included in the count batch
 *   picker body   → it must render the value + "No value" pair
 *   call site     → the body must be given a way to COMMIT the value
 *   store         → that commit must reach `setPropertyFilterValues`
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

describe("the filter panel offers scalar definitions as filter rows", () => {
  const panel = code("app/(app)/[workspace]/issues-filter.tsx");

  it("derives the filterable set from core, not a local hardcoded list", () => {
    // The defect was a locally maintained enumeration that stopped at actor.
    // Reading the shared predicate is what makes the two unable to drift.
    expect(panel).toContain("isFilterablePropertyType");
    expect(panel).not.toMatch(/p\.type === "select"/);
  });

  it("includes scalar definitions in the facet request", () => {
    // A scalar definition with no facet is a row with no "N issues" badge —
    // the panel and its own sub-sheet would then disagree about counts.
    expect(panel).toMatch(/filterableProperties[\s\S]{0,120}propertyFacetable/);
  });
});

describe("the filter picker body renders the scalar value + No-value pair", () => {
  const bodies = code("components/issue/pickers/filter-picker-bodies.tsx");

  it("branches scalar definitions to their own body", () => {
    expect(bodies).toContain("isScalarPropertyType");
    expect(bodies).toContain("<ScalarPropertyFilterBody");
  });

  it("offers a No-value row carrying the server's sentinel", () => {
    expect(bodies).toMatch(/NO_VALUE_KEY/);
    expect(bodies).toContain("filter.noPropertyValue");
  });

  it("refuses to commit the reserved sentinel as a literal value", () => {
    // The server reads "__none__" as "key absent", so letting a typed
    // "__none__" through would silently convert a value filter into a No-value
    // filter. Web's commitValue refuses it for the same reason.
    expect(bodies).toMatch(/value === NO_VALUE_KEY\) return/);
  });
});

describe("the scalar body's commit is actually wired to the store", () => {
  const route = code("app/(app)/[workspace]/issues-filter-picker.tsx");

  it("passes a set-values handler alongside the toggle handler", () => {
    // `togglePropertyFilter` cannot express a scalar commit: it would toggle
    // one value in a set. Without this prop the input is a control the user
    // can type into that commits nothing.
    expect(route).toMatch(/onSetValues=\{/);
  });

  it("routes that handler to setPropertyFilterValues", () => {
    expect(route).toContain("setPropertyFilterValues");
  });
});

describe("the store exposes the whole-set replacement", () => {
  const slice = code("data/stores/issue-filter-slice.ts");

  it("declares and registers setPropertyFilterValues", () => {
    expect(slice).toContain("setPropertyFilterValues:");
    // Registered in the pluckable action-name union, or the concrete stores
    // never receive it and the call site is dead at runtime.
    expect(slice).toMatch(/\|\s*"setPropertyFilterValues"/);
  });

  it("drops the key on an empty set rather than sending an empty filter", () => {
    // An empty array on the wire is not "no filter" to the server; removing
    // the key is.
    expect(slice).toMatch(
      /setPropertyFilterValues[\s\S]{0,400}values\.length === 0\)[\s\S]{0,80}delete propertyFilters/,
    );
  });
});
