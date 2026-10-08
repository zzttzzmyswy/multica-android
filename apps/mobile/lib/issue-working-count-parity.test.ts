/**
 * The working dimension on the server COUNT channels (iteration 213, MYS-2017).
 *
 * The defect this pins: with 「智能体正在处理」 on, the table rendered 3 rows while
 * its group header still read 「进行中 34」 and every filter badge kept its
 * unfiltered number (measured on the live deployment: the badges read 34 / 16 /
 * 1408 … and the headers summed to 1952).
 *
 * Rows narrow by a CLIENT predicate (`applyIssueFilters` over
 * `deriveRunningIssueIds`). The two channels that ask the SERVER for a number —
 * group descriptors (`lib/issue-table-group-counts.ts`) and facet badges
 * (`lib/issue-facet-counts.ts`) — were built from a window carrying no working
 * dimension at all, so both counted a DIFFERENT set than the rows. Web does not
 * have this bug: its `tableQuerySpec.filters` carries `working_issue_ids`, and
 * the same spec feeds the rows, the facet request and the group query
 * (`packages/views/issues/surface/use-issue-surface-controller.ts:441-443`,
 * `:498-509`, `:600-605`).
 *
 * The single-point fix is `buildIssueTableGroupQuerySpec`: the facet bridge
 * reuses it verbatim, so teaching it the dimension repairs both channels at
 * once. These tests pin that, plus the two rules that make it safe — the
 * dimension lives on a COUNT-ONLY window type, so it can never reach the list
 * request or its cache key, and it fails closed when the projection has not
 * resolved.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildIssueTableGroupQuerySpec,
  countWorkingOnly,
  myIssueTableScope,
  withWorkingCountDimension,
  workspaceIssueTableScope,
} from "./issue-table-group-counts";
import { buildIssueFacetQuerySpec } from "./issue-facet-counts";
import type {
  IssueCountWindowParams,
  IssueListWindowParams,
} from "@/data/queries/issue-keys";
import { buildIssueWindow, defaultIssueFilterSlice } from "@/data/stores/issue-filter-slice";

const APP_ROOT = path.resolve(__dirname, "..");

/** Source with comments removed — an assertion must match real code. */
function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const scope = { kind: "workspace" } as const;

describe("buildIssueTableGroupQuerySpec — the working dimension", () => {
  it("passes an explicit id list through to the server filter", () => {
    const spec = buildIssueTableGroupQuerySpec(scope, {
      working_issue_ids: ["i1", "i2"],
    });
    expect(spec.filters.working_issue_ids).toEqual(["i1", "i2"]);
  });

  it("passes an EMPTY list through as empty, not as absent", () => {
    // The server reads presence, not length: an explicit empty list becomes
    // `FALSE` (issue_table_query.go:616-627), which is the truthful answer for
    // "the filter is on and nobody is running". Omitting the key instead would
    // drop the restriction and restore the unfiltered count — the original bug,
    // in the one moment it is most visible.
    const spec = buildIssueTableGroupQuerySpec(scope, { working_issue_ids: [] });
    expect(spec.filters.working_issue_ids).toEqual([]);
    expect("working_issue_ids" in spec.filters).toBe(true);
  });

  it("omits the dimension entirely when the window carries none", () => {
    expect(buildIssueTableGroupQuerySpec(scope, {}).filters).toEqual({
      include_sub_issues: true,
    });
  });

  it("keeps every other dimension alongside it", () => {
    const spec = buildIssueTableGroupQuerySpec(scope, {
      statuses: ["in_progress"],
      working_issue_ids: ["i1"],
    });
    expect(spec.filters.statuses).toEqual(["in_progress"]);
    expect(spec.filters.working_issue_ids).toEqual(["i1"]);
  });

  it("reaches the facet channel through the shared spec builder", () => {
    // The facet request builds no filters of its own — it delegates. If it ever
    // stopped delegating, the badges would keep the unfiltered number while the
    // headers narrowed, which is half of the reported defect.
    const win: IssueCountWindowParams = { working_issue_ids: ["i1"] };
    expect(buildIssueFacetQuerySpec(scope, win)).toEqual(
      buildIssueTableGroupQuerySpec(scope, win, true),
    );
    expect(
      buildIssueFacetQuerySpec(scope, win).filters.working_issue_ids,
    ).toEqual(["i1"]);
  });

  it("carries the dimension for every scope the three surfaces count against", () => {
    for (const s of [
      workspaceIssueTableScope("all"),
      workspaceIssueTableScope("agents"),
      myIssueTableScope("assigned"),
      myIssueTableScope("all"),
      { kind: "project" as const, project_id: "p1" },
    ]) {
      expect(
        buildIssueTableGroupQuerySpec(s, { working_issue_ids: ["i1"] }).filters
          .working_issue_ids,
      ).toEqual(["i1"]);
    }
  });
});

describe("withWorkingCountDimension", () => {
  const running = new Set(["i2", "i1"]);

  it("adds the running id set, order-insensitively", () => {
    expect(withWorkingCountDimension({ statuses: ["todo"] }, true, running)).toEqual(
      { statuses: ["todo"], working_issue_ids: ["i1", "i2"] },
    );
  });

  it("fails closed while the projection is unresolved", () => {
    // An unresolved snapshot is `undefined`; the toggle being on means the user
    // asked for "only what is working", and nothing has been shown to be
    // working yet. Degrading to "no restriction" would restore the unfiltered
    // count exactly when it is most visible — the first paint after the toggle.
    expect(withWorkingCountDimension({}, true, undefined)).toEqual({
      working_issue_ids: [],
    });
  });

  it("treats a resolved EMPTY set as a real answer", () => {
    // "Nobody is running" is a fact, not a missing value: the counts must read
    // zero rather than fall back to the unfiltered number.
    expect(withWorkingCountDimension({}, true, new Set())).toEqual({
      working_issue_ids: [],
    });
  });

  it("returns the window untouched while the dimension is off", () => {
    const win: IssueListWindowParams = { statuses: ["todo"] };
    expect(withWorkingCountDimension(win, false, running)).toEqual(win);
    // Identity, not just equality: an off clamp must not allocate a new object
    // for the surface to memoise against.
    expect(withWorkingCountDimension(win, false, running)).toBe(win);
  });
});

describe("countWorkingOnly — the scope clamp", () => {
  it("keeps the toggle for the surfaces whose rows honour it", () => {
    expect(countWorkingOnly("all", true)).toBe(true);
    expect(countWorkingOnly("my", true)).toBe(true);
  });

  it("clamps it off for the project surface", () => {
    // Mobile's project surface hard-codes `workingOnly: false` for its rows
    // (web renders that IssueSurface with no agents-working chip). If the
    // counts honoured a store field the rows ignore, the sheet would badge
    // narrowed numbers over an unnarrowed list — the same class of
    // contradiction this iteration closes, just moved one screen over.
    expect(countWorkingOnly("project", true)).toBe(false);
    expect(countWorkingOnly("project", false)).toBe(false);
  });

  it("clamps off when the toggle is off, on every scope", () => {
    for (const s of ["all", "my", "project"] as const) {
      expect(countWorkingOnly(s, false)).toBe(false);
    }
  });
});

describe("the count window can never reach the list path", () => {
  it("keeps the list window type free of the working dimension", () => {
    // The list window is spread verbatim into `GET /api/issues` and into the
    // list CACHE KEY. Carrying the running set there would refetch every list
    // on every task start/stop — the set moves second-to-second — for rows the
    // client predicate has already narrowed. The two window types are separate
    // so this is a TYPE error, not a missing strip helper someone can forget.
    for (const file of ["data/queries/issues.ts", "data/queries/my-issues.ts"]) {
      const src = code(file);
      expect(src).toContain("type IssueListWindowParams");
      expect(src).not.toContain("working_issue_ids");
    }
    const keys = code("data/queries/issue-keys.ts");
    const listWindow = keys.slice(
      keys.indexOf("export type IssueListWindowParams"),
      keys.indexOf("export type IssueCountWindowParams"),
    );
    expect(listWindow).not.toContain("working_issue_ids");
    // …and the count window is where it lives instead.
    const countWindow = keys.slice(keys.indexOf("export type IssueCountWindowParams"));
    expect(countWindow).toContain("working_issue_ids");
  });

  it("never sends the dimension from a list builder", () => {
    // The window the list spreads is `buildIssueWindow`'s output, which stays
    // an `IssueListWindowParams` — so this asserts the field never appears on
    // the request object those builders construct.
    const issues = code("data/queries/issues.ts");
    expect(issues).not.toContain("working_issue_ids");
    const myIssues = code("data/queries/my-issues.ts");
    expect(myIssues).not.toContain("working_issue_ids");
  });

  it("keeps buildIssueWindow's own output free of it", () => {
    // `workingOnly` stays a pure client predicate here; the id set reaches the
    // counts through `withWorkingCountDimension` instead. The builder does not
    // even accept the running set, so the list window it returns — which is
    // spread into `GET /api/issues` and into the list cache key — cannot carry
    // a set that moves second-to-second.
    const win = buildIssueWindow(defaultIssueFilterSlice());
    expect("working_issue_ids" in win).toBe(false);
    expect(win).toEqual({});
  });
});

describe("the surfaces hand their running set to the count channels", () => {
  for (const [file, scopeKey] of [
    ["app/(app)/[workspace]/more/issues.tsx", "all"],
    ["app/(app)/[workspace]/(tabs)/my-issues.tsx", "my"],
  ] as const) {
    it(`${file} narrows its group-count window`, () => {
      const src = code(file);
      // Subscribing is not enough — the set has to reach the window the count
      // query is built from, through the scope clamp.
      expect(src).toContain("useRunningIssueIds()");
      expect(src).toContain("withWorkingCountDimension(");
      expect(src).toContain(`countWorkingOnly("${scopeKey}", workingOnly)`);
      expect(src).toMatch(/window:\s*countWindow/);
    });
  }

  it("leaves the project surface's counts unnarrowed, like its rows", () => {
    const src = code("components/project/project-issue-surface.tsx");
    expect(src).toContain("applyIssueFilters(scopedIssues, filterState)");
    expect(src).not.toContain("useRunningIssueIds");
    expect(src).not.toContain("withWorkingCountDimension");
  });

  it("wires both filter-sheet routes through the scope clamp", () => {
    // The panel and its sub-picker are separate routes that must badge the SAME
    // numbers, so both read the running set and both clamp by the surface's
    // scope. They differ only in where the slice value comes from: the panel
    // destructures `s.workingOnly`, the picker reads it off the store it
    // already fetched for the window.
    const expectations = [
      [
        "app/(app)/[workspace]/issues-filter.tsx",
        "countWorkingOnly(resolvedScope, workingOnly)",
      ],
      [
        "app/(app)/[workspace]/issues-filter-picker.tsx",
        "countWorkingOnly(resolvedScope, facetStore.workingOnly)",
      ],
    ] as const;
    for (const [file, clamp] of expectations) {
      const src = code(file);
      expect(src).toContain("useRunningIssueIds()");
      expect(src).toContain("withWorkingCountDimension(");
      expect(src).toContain(clamp);
    }
  });
});
