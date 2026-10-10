/**
 * The two issue-list dimensions that must narrow the SERVER window rather than
 * the loaded page (MYS-2066).
 *
 * The defect this pins, measured against the live deployment (1996 issues, 3 of
 * them running): `GET /api/issues` returns the newest 100 rows, the list view
 * deliberately does NOT drain the rest, and 「智能体工作中」 was a client
 * predicate over that window — so the switch asked "which of the newest 100
 * issues is an agent working on" and **0 of the 3 running issues were in the
 * first page**. The switch always produced an empty list. 「显示子任务」 off had
 * the same shape: it hid the 22 sub-issues the loaded page happened to contain,
 * not the 231 the workspace has.
 *
 * Web narrows the query that feeds its rows
 * (`use-issue-surface-controller.ts:441-444`) and so never had this. The fix is
 * to project the two switches onto `GET /api/issues`'s own params (`ids` /
 * `top_level_only`), which the server has always supported.
 *
 * Two rules make that safe, and both are asserted here because both are
 * invisible at runtime until they are wrong:
 *
 *   1. **Carry only while active.** These join the list CACHE KEY, and `ids`
 *      holds a set that moves second-to-second. Emitting it while the switch is
 *      off would refetch and re-key every list each time any task started.
 *   2. **Empty is a real answer, absent is not.** The server reads PRESENCE of
 *      `ids`, so "the switch is on and nobody is running" must send `ids=` and
 *      narrow to nothing — not omit the param and restore the whole workspace.
 *
 * A component test cannot see any of this: the mobile vitest lane is Node-only
 * and renders no RN components (`vitest.config.ts`). What can be checked is the
 * pure projection, the serialization, and that each surface is wired to the
 * right window — which is exactly where this class of bug lives.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { issueRowNarrowing } from "./issue-row-narrowing";
import type { IssueListWindowParams } from "@/data/queries/issue-keys";

const APP_ROOT = path.resolve(__dirname, "..");

/** Source with comments removed — an assertion must match real code, and every
 *  file here carries long comments naming the very symbols being asserted. */
function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const OFF = { workingOnly: false, showSubIssues: true };

describe("issueRowNarrowing — the working dimension", () => {
  it("omits the dimension entirely while the switch is off", () => {
    // Not merely falsy — the KEY must be absent. The bag is spread into the
    // window that becomes the list cache key, so an `ids: undefined` that
    // survived serialization would still change the key's shape.
    const win = issueRowNarrowing(OFF, new Set(["i1"]));
    expect("ids" in win).toBe(false);
    expect(win).toEqual({});
  });

  it("restricts the window to the running set while the switch is on", () => {
    const win = issueRowNarrowing({ ...OFF, workingOnly: true }, new Set(["i1", "i2"]));
    expect(win.ids).toEqual(["i1", "i2"]);
  });

  it("sorts the id list so two Set orders key identically", () => {
    // `ids` is in the cache key. Two snapshots of the same logical set that
    // differ only in Set iteration order must not produce two cache entries —
    // that would refetch the list for rows that did not change.
    const a = issueRowNarrowing({ ...OFF, workingOnly: true }, new Set(["b", "a", "c"]));
    const b = issueRowNarrowing({ ...OFF, workingOnly: true }, new Set(["c", "b", "a"]));
    expect(a.ids).toEqual(["a", "b", "c"]);
    expect(a).toEqual(b);
  });

  it("fails closed while the projection is unresolved", () => {
    // `undefined` means the agent-task snapshot has not landed. The switch being
    // on is the user asking for "only what is working", and nothing has been
    // shown to be working yet — so the window is empty. Degrading to "no
    // restriction" would restore the whole workspace at the one moment it is
    // most visible: the first paint after the toggle flips. `applyIssueFilters`
    // takes the same read for the rows it filters (`filter-issues.ts:140-147`).
    const win = issueRowNarrowing({ ...OFF, workingOnly: true }, undefined);
    expect(win.ids).toEqual([]);
  });

  it("treats a resolved EMPTY set as a real answer, not as absent", () => {
    // The load-bearing distinction, and the defect's most likely relapse: an
    // empty list must reach the wire as `ids=` (server: `i.id = ANY('{}')`,
    // i.e. nothing) rather than being dropped as "nothing to filter by" — which
    // would show the entire workspace under a switch that says "working only".
    const win = issueRowNarrowing({ ...OFF, workingOnly: true }, new Set());
    expect("ids" in win).toBe(true);
    expect(win.ids).toEqual([]);
    expect(win).not.toEqual(issueRowNarrowing(OFF, new Set()));
  });
});

describe("issueRowNarrowing — the sub-issues dimension", () => {
  it("excludes sub-issues server-side only for an explicit false", () => {
    expect(issueRowNarrowing({ ...OFF, showSubIssues: false }, undefined)).toEqual({
      top_level_only: true,
    });
  });

  it("emits nothing in the default (sub-issues shown) state", () => {
    // `showSubIssues` defaults to TRUE, so emitting anything here would put a
    // key on every list in the app for a narrowing that does not exist. Web's
    // `include_sub_issues` is a plain boolean the server only acts on when
    // false, and the client predicate agrees (`filter-issues.ts:197`).
    const win = issueRowNarrowing(OFF, undefined);
    expect("top_level_only" in win).toBe(false);
    expect(win).toEqual({});
  });

  it("carries both dimensions together when both switches are active", () => {
    const win = issueRowNarrowing(
      { workingOnly: true, showSubIssues: false },
      new Set(["i2", "i1"]),
    );
    expect(win).toEqual({ ids: ["i1", "i2"], top_level_only: true });
  });

  it("is a valid window bag for the server params it claims to be", () => {
    // Type-level contract made executable: the return type must stay a subset of
    // `IssueListWindowParams`, which is what lets a surface spread it into the
    // list window without a cast.
    const win: Pick<IssueListWindowParams, "ids" | "top_level_only"> =
      issueRowNarrowing({ workingOnly: true, showSubIssues: false }, new Set(["i1"]));
    expect(Object.keys(win).sort()).toEqual(["ids", "top_level_only"]);
  });
});

describe("the surfaces narrow their ROW window, not only their counts", () => {
  // The regression this guards is precise and was the state before MYS-2066:
  // a surface that builds a narrowed COUNT window and hands the PLAIN window to
  // its list query. Every count is then right and the list below them is wrong,
  // which is invisible in a screenshot — the numbers agree with each other.
  for (const [file, scopeKey] of [
    ["app/(app)/[workspace]/more/issues.tsx", "all"],
    ["app/(app)/[workspace]/(tabs)/my-issues.tsx", "my"],
  ] as const) {
    it(`${file} builds a row window from its own switches`, () => {
      const src = code(file);
      expect(src).toContain("issueRowNarrowing(");
      expect(src).toContain("const rowWindow = useMemo(");
      expect(src).toContain(`countWorkingOnly("${scopeKey}", workingOnly)`);
    });

    it(`${file} hands the ROW window to the list query`, () => {
      const src = code(file);
      // The list query must read `rowWindow`. Asserting only that `rowWindow`
      // exists would pass on a file that computed it and never used it — the
      // exact shape of the original defect.
      expect(src).toMatch(/issueListOptions\(wsId, rowWindow\)|\(wsId, userId, rowWindow\)|myIssueListOptions\(wsId, scope, filter, rowWindow\)/);
      expect(src).not.toMatch(/issueListOptions\(wsId, window\)/);
      expect(src).not.toMatch(/myIssuesAllOptions\(wsId, userId, window\)/);
      expect(src).not.toMatch(/myIssueListOptions\(wsId, scope, filter, window\)/);
    });
  }

  it("keeps the header chip on the PLAIN window so its number cannot flicker", () => {
    // The chip labels the toggle. If its request were built from `rowWindow`,
    // clicking the chip would re-key the request that produces the number the
    // chip is showing, and the count would blink as the user clicked it. Web
    // keeps the same split (`workingAgentsQuerySpec` drops the dimension).
    for (const file of [
      "app/(app)/[workspace]/more/issues.tsx",
      "app/(app)/[workspace]/(tabs)/my-issues.tsx",
    ]) {
      const src = code(file);
      const block = src.slice(
        src.indexOf("const workingAgentsQuery = useMemo("),
        src.indexOf("const { data: headerWorkingAgents }"),
      );
      expect(block).toContain("window,");
      expect(block).not.toContain("rowWindow");
      expect(block).not.toContain("countWindow");
    }
  });

  it("keeps the count window on the PLAIN window plus its own spelling", () => {
    // The two channels name the same restriction differently — the list API
    // says `ids`, the Table spec says `working_issue_ids` — and each window
    // must carry only its own. A count window built from `rowWindow` would put
    // both spellings in one bag, and a comment could then claim either.
    for (const file of [
      "app/(app)/[workspace]/more/issues.tsx",
      "app/(app)/[workspace]/(tabs)/my-issues.tsx",
    ]) {
      const src = code(file);
      const block = src.slice(
        src.indexOf("const countWindow = useMemo("),
        src.indexOf("const groupCountQuery = useMemo("),
      );
      expect(block).toContain("withWorkingCountDimension(");
      expect(block).not.toContain("rowWindow");
    }
  });

  it("narrows the project surface too, whose projects exceed one page", () => {
    // The project surface sent NO window at all and filtered purely
    // client-side. That is only equivalent while a project fits in one page —
    // and on the deployment four of twelve projects hold more than 100 issues
    // (432 at the top), so 「显示子任务」 off hid only the sub-issues that
    // happened to be in the loaded page.
    const src = code("components/project/project-issue-surface.tsx");
    expect(src).toContain("issueRowNarrowing(filterState, undefined)");
    expect(src).toContain("projectIssuesOptions(wsId, projectId, rowWindow)");
  });

  it("keeps the project surface's working switch off on BOTH channels", () => {
    // Web renders the project page's IssueSurface with no agents-working chip,
    // and mobile's project rows hard-code `workingOnly: false`. Reading a store
    // field there would let a stale `true` narrow rows that ignore it — the
    // same "counts contradict the list" defect this module exists to prevent.
    const src = code("components/project/project-issue-surface.tsx");
    expect(src).toContain("workingOnly: false");
    expect(src).not.toContain("useRunningIssueIds");
  });
});

describe("the server window params carry both new dimensions", () => {
  it("serializes an EMPTY ids list instead of dropping it", () => {
    // `search.set(k, v.map(String).join(","))` on an empty array yields "ids=",
    // which is what the server's `Has("ids")` check reads. The generic
    // `length > 0` guard every other list keeps would silently omit it — so
    // this asserts the one exception directly against the serialization source.
    const src = code("data/api.ts");
    expect(src).toContain('if (v.length > 0 || k === "ids")');
  });

  it("routes an ids window through the POST twin", () => {
    // A running-issue set can hold hundreds of UUIDs — enough to blow the ~8 KB
    // request-line cap of common reverse proxies. Web routes on the same
    // condition (`client.ts:791`), and the POST handler rebuilds the query
    // string from the same key/value pairs, so the two transports agree.
    const src = code("data/api.ts");
    expect(src).toContain('if (params.ids) {');
    expect(src).toContain('"/api/issues/query"');
  });

  it("treats both dimensions as key-changing in every list key", () => {
    // If the key ignored them, an empty restricted window would overwrite the
    // plain list's cache entry — so clearing the filter would show an empty
    // list, and the restricted window would show the unrestricted rows.
    for (const file of ["data/queries/issues.ts", "data/queries/my-issues.ts"]) {
      const src = code(file);
      expect(src).toContain("window.ids != null ||");
      expect(src).toContain("window.top_level_only === true");
    }
  });

  it("strips BOTH spellings from the chip's facet window", () => {
    // The chip reads the row window, which carries `ids` while the toggle is
    // on. Stripping only the count spelling would leave the row spelling in the
    // bag — and a key that stays stable only because a downstream builder
    // happens to ignore a field is one refactor away from flickering.
    const src = code("data/queries/working-agents.ts");
    expect(src).toContain("ids: _rows,");
    expect(src).toContain("working_issue_ids: _counts,");
  });
});
