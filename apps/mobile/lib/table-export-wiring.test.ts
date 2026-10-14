/**
 * Wiring guard for the server-cursor "Export all" (MYS-2157 / iter 241).
 *
 * Node-only vitest cannot render `IssueTableView`, so the pure walk
 * (`issue-table-export-server.test.ts`) fixes nothing if a surface never hands
 * the query down, or if the component goes back to serializing its loaded
 * window. Both failures are silent in the same way: the CSV still appears, it
 * is just short — which is the defect this iteration removes.
 *
 * Assertions read the source after stripping comments, the
 * `table-hierarchy-wiring.test.ts` convention, so a comment quoting a call
 * cannot satisfy one.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

/** Every surface that renders the shared table. */
const SURFACES = [
  "app/(app)/[workspace]/more/issues.tsx",
  "app/(app)/[workspace]/(tabs)/my-issues.tsx",
  "components/project/project-issue-surface.tsx",
];

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("table export wiring", () => {
  it("covers every surface that renders the table", () => {
    for (const file of SURFACES) expect(() => code(file)).not.toThrow();
  });

  for (const file of SURFACES) {
    it(`${file} passes the export query down to the table`, () => {
      // The prop is required, so its absence is a typecheck failure — but the
      // guard pins it anyway, because a future surface could pass a
      // hand-rolled window object that no longer matches the counts.
      expect(code(file)).toMatch(/^\s*exportQuery=\{groupCountQuery\}$/m);
    });

    it(`${file} no longer supplies a client fetch-state window`, () => {
      // The whole point of the change: "export all" is no longer judged from
      // the client's loaded window. A reintroduced exportWindow means a surface
      // went back to proving completeness from a partial fetch.
      //
      // `isFetchNextPageError` deliberately stays — the aggregate views still
      // drain their window so board / swimlane / table can group it. Only the
      // EXPORT stopped depending on that drain.
      expect(code(file)).not.toContain("exportWindow");
    });
  }

  it("walks the server rows endpoint rather than the loaded rows", () => {
    const src = code("components/issue/table-view.tsx");
    expect(src).toContain("collectIssueTableExportRows(");
    expect(src).toContain("buildIssueTableExportQuerySpec(");
    expect(src).toContain("api.listIssueTableRows(");
    // The flat result set: no grouping, no hierarchy. A non-null group_key or
    // parent_id is exactly what the walk refuses.
    expect(src).toContain('group: { kind: "none" }');
    expect(src).toContain("group_key: null");
    expect(src).toContain("hierarchy: { enabled: false }");
    expect(src).toContain("parent_id: null");
    expect(src).toContain("limit: ISSUE_TABLE_EXPORT_PAGE_LIMIT");
  });

  it("keeps the selection scope on the rendered rows", () => {
    // Web draws the same line: a selection can only contain rows the user can
    // see, so it needs no server walk and no completeness assertion.
    const src = code("components/issue/table-view.tsx");
    expect(src).toMatch(/scope === "all"[\s\S]{0,120}collectExportRows\(\)/);
    expect(src).toContain("selectedIssues");
  });

  it("distinguishes the failure classes instead of collapsing them", () => {
    const src = code("components/issue/table-view.tsx");
    expect(src).toContain("IssueTableExportTooLargeError");
    expect(src).toContain("IssueTableExportIntegrityError");
    // Both must reach the user with their own key.
    expect(src).toContain('return "table.exportTooLarge"');
    expect(src).toContain('return "table.exportIncomplete"');
    // The old silent catch is what made an incomplete export invisible.
    expect(src).not.toContain(".catch(() => {})");
  });

  it("deleted the client-drain completeness gate rather than leaving it dead", () => {
    // The module and its three drain-era messages are unreachable now: there is
    // no client-side drain in the export path, so nothing can be "still
    // loading" and nothing can stop at a mid-walk row ceiling.
    expect(() =>
      readFileSync(path.join(APP_ROOT, "lib/issue-table-export-completeness.ts")),
    ).toThrow();
    for (const locale of ["en", "zh"]) {
      const bundle = readFileSync(
        path.join(APP_ROOT, `lib/i18n/locales/${locale}.json`),
        "utf8",
      );
      for (const dead of [
        "table.exportDraining",
        "table.exportDrainFailed",
        "table.exportRowCeiling",
      ]) {
        expect(bundle).not.toContain(dead);
      }
    }
  });
});
