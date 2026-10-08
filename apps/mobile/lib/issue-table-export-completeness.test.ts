/**
 * Fail-closed gate for the table view's "Export all" (MYS-2015).
 *
 * The mobile export serializes whatever rows the surface has already loaded,
 * while the aggregate views only *drain* the remaining pages on a best-effort
 * basis (`use-drain-issue-pages.ts`). Exporting before the drain finishes — or
 * after a page fetch gave up, or on a window stopped by the row ceiling —
 * produces a short CSV that looks completely successful. Web fails closed on
 * the same input (`exportTableIssues`, packages/views/issues/surface/
 * use-issue-surface-controller.ts:715) instead of emitting a truncated file.
 *
 * Why this is NOT web's equality check against the server `total`: the rows the
 * table shows are the *client-filtered* window. `applyIssueFilters` narrows by
 * `workingOnly` / `showSubIssues` and the members/agents scope tabs narrow by
 * assignee type, none of which `buildIssueWindow` sends to the server
 * (data/stores/issue-filter-slice.ts:701) — and `issue:deleted` strips rows out
 * of the paginated cache while the cached `total` stays stale
 * (data/realtime/use-issues-realtime.ts:59). So `loaded !== total` is the
 * ordinary state of a filtered table, and an equality assertion would fail
 * every export the moment a filter was on: a false alarm, not a safety net.
 *
 * The fetch state IS provable: `hasNextPage === false` means the server
 * reported the window exhausted (`nextIssuePageParam`, issue-pagination.ts:72).
 * The three blocked reasons below are its failure modes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPORT_MAX_ROWS,
  IssueTableExportIntegrityError,
  assertExportComplete,
  exportBlockedMessageKey,
  exportBlockedReason,
  type IssueTableExportWindow,
} from "./issue-table-export-completeness";

/** A window whose every page has been fetched — the complete state. */
const complete: IssueTableExportWindow = {
  hasNextPage: false,
  isFetchNextPageError: false,
  loadedRows: 800,
};

const APP_ROOT = path.resolve(__dirname, "..");

/** Source with comments stripped, so a comment quoting a call cannot satisfy an
 *  assertion (the `table-hierarchy-wiring.test.ts` convention). */
function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Every surface that renders the shared table. */
const SURFACES = [
  "app/(app)/[workspace]/more/issues.tsx",
  "app/(app)/[workspace]/(tabs)/my-issues.tsx",
  "components/project/project-issue-surface.tsx",
];

describe("exportBlockedReason", () => {
  it("never constrains the selection scope", () => {
    // The selected set can only contain rendered rows, so it is inherently
    // bounded — web applies no completeness assertion to it either.
    expect(
      exportBlockedReason("selected", {
        hasNextPage: true,
        isFetchNextPageError: true,
        loadedRows: 50,
      }),
    ).toBeNull();
  });

  it("passes a fully drained window", () => {
    expect(exportBlockedReason("all", complete)).toBeNull();
  });

  it("blocks while another page is still outstanding", () => {
    expect(exportBlockedReason("all", { ...complete, hasNextPage: true })).toBe(
      "draining",
    );
  });

  it("blocks after the drain gave up on a failed page", () => {
    // `shouldDrainNextPage` stops on `isFetchNextPageError` and never retries
    // (use-drain-issue-pages.ts:34), so every later export would serialize the
    // short collection behind a successful-looking file.
    expect(
      exportBlockedReason("all", {
        ...complete,
        hasNextPage: true,
        isFetchNextPageError: true,
      }),
    ).toBe("drainFailed");
  });

  it("prefers the failed-page reason over the ceiling", () => {
    // A failed page is the more actionable diagnosis: retrying the fetch can
    // help, whereas the ceiling cannot be raised from the UI.
    expect(
      exportBlockedReason("all", {
        hasNextPage: true,
        isFetchNextPageError: true,
        loadedRows: EXPORT_MAX_ROWS,
        maxRows: EXPORT_MAX_ROWS,
      }),
    ).toBe("drainFailed");
  });

  it("reports the row ceiling when the cap is what stopped the walk", () => {
    expect(
      exportBlockedReason("all", {
        hasNextPage: true,
        isFetchNextPageError: false,
        loadedRows: EXPORT_MAX_ROWS,
        maxRows: EXPORT_MAX_ROWS,
      }),
    ).toBe("rowCeiling");
  });

  it("does not report the ceiling when the cap coincides with a complete window", () => {
    // 10k loaded AND no next page is a genuinely complete window — the cap did
    // not truncate anything, so nothing is blocked.
    expect(
      exportBlockedReason("all", {
        ...complete,
        loadedRows: EXPORT_MAX_ROWS,
        maxRows: EXPORT_MAX_ROWS,
      }),
    ).toBeNull();
  });

  it("blocks one row short of the ceiling as still-draining", () => {
    // Below the cap the walk is merely unfinished, which is a different user
    // story from "the cap stopped us": waiting (or retrying) is the fix.
    expect(
      exportBlockedReason("all", {
        hasNextPage: true,
        isFetchNextPageError: false,
        loadedRows: EXPORT_MAX_ROWS - 1,
        maxRows: EXPORT_MAX_ROWS,
      }),
    ).toBe("draining");
  });

  it("defaults the ceiling to the drain's own cap", () => {
    // Call sites pass only the fetch state; the cap must not be re-derived.
    expect(
      exportBlockedReason("all", {
        hasNextPage: true,
        isFetchNextPageError: false,
        loadedRows: EXPORT_MAX_ROWS,
      }),
    ).toBe("rowCeiling");
  });
});

describe("assertExportComplete", () => {
  it("throws the integrity marker when the window is short", () => {
    expect(() =>
      assertExportComplete("all", { ...complete, hasNextPage: true }),
    ).toThrow(IssueTableExportIntegrityError);
  });

  it("returns quietly for a complete window", () => {
    expect(() => assertExportComplete("all", complete)).not.toThrow();
  });

  it("returns quietly for the selection scope whatever the fetch state", () => {
    expect(() =>
      assertExportComplete("selected", {
        hasNextPage: true,
        isFetchNextPageError: true,
        loadedRows: 50,
      }),
    ).not.toThrow();
  });

  it("names the error class so the UI translates it instead of leaking the message", () => {
    // Mirrors web's marker class (packages/views/issues/components/
    // table-view-model.ts:14), which the UI maps to `table.export_failed`.
    const err = new IssueTableExportIntegrityError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("IssueTableExportIntegrityError");
    expect(err.message.length).toBeGreaterThan(0);
  });
});

describe("exportBlockedMessageKey", () => {
  it("maps every reason to its own i18n key", () => {
    const keys = (["draining", "drainFailed", "rowCeiling"] as const).map(
      exportBlockedMessageKey,
    );
    expect(new Set(keys).size).toBe(3);
    for (const key of keys) expect(key.startsWith("table.")).toBe(true);
  });
});

/**
 * Wiring guard. The pure gate above fixes nothing if a surface never hands the
 * fetch state down, or if the export path swallows the rejection again — both
 * are silent in the worst way, which is exactly the defect this iteration
 * exists to remove. Node-only vitest cannot render the component, so these
 * assertions read the source the way `table-hierarchy-wiring.test.ts` does.
 */
describe("export completeness wiring", () => {
  for (const file of SURFACES) {
    it(`${file} passes the export window down to the table`, () => {
      const src = code(file);
      expect(src).toContain("exportWindow={{");
      // All three fields the gate reads must come from the live query — a
      // partially wired object would silently allow truncated exports.
      expect(src).toMatch(/exportWindow=\{\{[\s\S]*?hasNextPage[\s\S]*?\}\}/);
      expect(src).toMatch(
        /exportWindow=\{\{[\s\S]*?isFetchNextPageError[\s\S]*?\}\}/,
      );
      expect(src).toMatch(/exportWindow=\{\{[\s\S]*?loadedRows[\s\S]*?\}\}/);
    });
  }

  it("guards the export path and never swallows the failure", () => {
    const src = code("components/issue/table-view.tsx");
    // The gate must be consulted before a file is written.
    expect(src).toContain("assertExportComplete(");
    expect(src).toContain("exportBlockedMessageKey(");
    // The old silent catch is what made an incomplete export invisible; its
    // return is the regression this pins.
    expect(src).not.toContain(".catch(() => {})");
  });

  it("keeps the table's export window required, so a new surface cannot skip it", () => {
    // A required prop turns a forgotten wiring into a typecheck failure rather
    // than a silent partial CSV.
    const src = code("components/issue/table-view.tsx");
    expect(src).toMatch(/^\s*exportWindow:\s*IssueTableExportWindow;$/m);
  });
});
