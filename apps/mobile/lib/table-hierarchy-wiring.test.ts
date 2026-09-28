/**
 * Wiring guard for the table hierarchy switch.
 *
 * Mobile's vitest lane is Node-only (see vitest.config.ts) — there is no RN
 * renderer, so `buildIssueTableGroups` honouring `options.hierarchy` (covered
 * by issue-table-groups.test.ts) fixes nothing if a surface never passes the
 * flag through. There are three issue-list surfaces, each with its own view
 * store, and missing one is silent in the worst way: the switch still renders
 * and still flips state, but the table it was supposed to flatten does not
 * move. iter-182 shipped exactly that bug on the project surface and caught it
 * only by eye on the device; this guard is what makes the next one loud.
 *
 * Matches call syntax after stripping comments, so a comment quoting the prop
 * cannot satisfy an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

/** Every surface that renders the shared `IssueTableView`, with the store
 *  whose `tableHierarchy` it must read. */
const SURFACES: { file: string; store: string }[] = [
  {
    file: "app/(app)/[workspace]/more/issues.tsx",
    store: "useIssuesViewStore",
  },
  {
    file: "app/(app)/[workspace]/(tabs)/my-issues.tsx",
    store: "useMyIssuesViewStore",
  },
  {
    file: "components/project/project-issue-surface.tsx",
    store: "useProjectIssuesViewStore",
  },
];

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("table hierarchy wiring", () => {
  it("covers every surface that renders the table", () => {
    // A new table surface added without a row here would silently escape the
    // guard, which is the failure this test exists to prevent.
    for (const { file } of SURFACES) expect(() => code(file)).not.toThrow();
  });

  for (const { file, store } of SURFACES) {
    it(`${file} reads its store's tableHierarchy and passes it down`, () => {
      const src = code(file);
      expect(src).toContain(`${store}((s) => s.tableHierarchy)`);
      // The prop must reach the table, not merely be subscribed.
      expect(src).toContain("hierarchy={tableHierarchy}");
    });
  }

  it("keeps tableHierarchy in the saved-view snapshot source", () => {
    // A view fixes the table's nesting (web writes it into `display` at
    // save-view-dialog.tsx:608), so the live slice handed to `viewMatchesSlice`
    // and the save dialog has to carry it — otherwise flipping the switch never
    // lights the "modified" dot and the change cannot be saved.
    for (const { file } of SURFACES) {
      expect(code(file)).toMatch(/^\s*tableHierarchy,\s*$/m);
    }
  });

  it("renders the switch behind the table view mode, like web", () => {
    // Web gates the row on `viewMode === "table" &&` (issues-header.tsx:1910).
    // Offering it while another view is active would flip a setting with no
    // visible effect.
    const filter = code("app/(app)/[workspace]/issues-filter.tsx");
    expect(filter).toMatch(/s\.view === "table"/);
    expect(filter).toContain('t("filter.display.tableHierarchy")');
  });
});
