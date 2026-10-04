/**
 * Wiring guard for the four-state remote-directory read (MYS-1892, widened by
 * MYS-1907).
 *
 * Mobile's vitest lane is Node-only (see vitest.config.ts) — there is no RN
 * renderer, so `resolveCatalogState` being correct proves nothing about what the
 * surfaces do with it. The regression this pins is exactly the one a
 * helper-level test cannot see: a caller destructures `{ data: rows = [] }` and
 * branches on `rows.length === 0`, which folds "still loading" and "request
 * failed" into "the workspace has none".
 *
 * Three assertions per surface, because any one alone is passable:
 *
 *   1. The surface reads the directory through `catalogRead` — otherwise there
 *      is no state to render.
 *   2. The surface does not destructure the raw query `data` with an empty
 *      default — the specific construct that collapsed the states.
 *   3. The surface's empty slot goes through `CatalogEmptySlot` — a surface that
 *      resolves the state and then re-implements the branches locally would
 *      drift from the copy and the retry semantics.
 *
 * Comments are stripped before matching, so a comment that quotes the banned
 * call cannot satisfy or trip an assertion.
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The pickers that read a workspace directory and said "there is nothing here"
 *  out of a read that had not settled. Each one carried its own absence
 *  sentence (「无匹配结果。」/「此工作区暂无项目。请在网页端创建。」/「此工作区暂无
 * 标签。」/「此工作区暂无成员或智能体。」) that a failed or in-flight request
 *  fell into.
 *
 *  The property catalog surfaces joined this list in MYS-1892 (they were the
 *  first half of the family); this iteration added the five picker bodies and
 *  the project-lead picker, which had the identical shape. */
const PICKER_SURFACES = [
  "components/issue/pickers/assignee-picker-body.tsx",
  "components/issue/pickers/mention-picker-body.tsx",
  "components/issue/pickers/label-picker-body.tsx",
  "components/issue/pickers/project-picker-body.tsx",
  "components/issue/pickers/filter-picker-bodies.tsx",
  "components/project/pickers/project-lead-picker-body.tsx",
  "components/issue/mention-suggestion-bar.tsx",
  "components/issue/subscriber-picker-sheet.tsx",
];

/** The property-catalog surfaces, which keep their own hook (it selects between
 *  the active-only and include-archived projections) but share the same
 *  resolver, the same state painter and the same `isResolved` gate. */
const PROPERTY_SURFACES: {
  file: string;
  hook: "useActivePropertyCatalog" | "usePropertyCatalog";
}[] = [
  { file: "app/(app)/[workspace]/issues-filter.tsx", hook: "useActivePropertyCatalog" },
  { file: "app/(app)/[workspace]/issues-filter-picker.tsx", hook: "useActivePropertyCatalog" },
  { file: "app/(app)/[workspace]/issue/[id]/picker/properties.tsx", hook: "usePropertyCatalog" },
  { file: "app/(app)/[workspace]/more/properties/[id].tsx", hook: "usePropertyCatalog" },
  { file: "components/issue/pickers/property-value-editor.tsx", hook: "usePropertyCatalog" },
];

/** Every surface in the family, for the checks that apply to all of them. */
const ALL_SURFACES = [
  ...PICKER_SURFACES,
  ...PROPERTY_SURFACES.map((s) => s.file),
];

/** Detail / edit routes that resolve ONE row out of a directory read.
 *
 *  Same defect one level up (MYS-1908): these wrote `if (q.isLoading) …; if
 *  (!record) → "does not exist"`, and `isLoading` is only true for the first
 *  attempt, so a failed read rendered "not found" over a record that was
 *  merely unreachable — 「还没有智能体」, 「还没有小队」, and 「该工作区已不可用。」
 *  (which also pushed the user out to the workspace switcher).
 *
 *  Each entry names the row it shows so the guard can assert the page gates on
 *  `recordRead`/`isResolved` rather than on `!<row>`. */
const RECORD_SURFACES = [
  "app/(app)/[workspace]/more/agents/[id].tsx",
  "app/(app)/[workspace]/more/agents/[id]/edit.tsx",
  "app/(app)/[workspace]/more/agents/[id]/integrations.tsx",
  "app/(app)/[workspace]/more/autopilots/[id].tsx",
  "app/(app)/[workspace]/more/autopilots/[id]/edit.tsx",
  "app/(app)/[workspace]/more/mcp-servers/[id].tsx",
  "app/(app)/[workspace]/more/squads/[id].tsx",
  "app/(app)/[workspace]/more/members/[id].tsx",
  "app/(app)/[workspace]/more/settings/workspace.tsx",
];

describe("remote-directory four-state wiring", () => {
  describe("record pages", () => {
    for (const file of RECORD_SURFACES) {
      const src = code(file);

      it(`${file} resolves its row through recordRead`, () => {
        expect(src).toContain("recordRead");
      });

      it(`${file} gates the not-found branch on the read being settled`, () => {
        // The collapse was `if (isLoading) …; if (!record) → "missing"`.
        // Anything that claims an absence must be downstream of a settled read.
        // Asserting the *shape* (`!read.isResolved`, or `read.isResolved ?`)
        // rather than the bare token, so a file cannot satisfy this by
        // importing the flag and never branching on it.
        expect(src).toMatch(/!\s*read\.isResolved|read\.isResolved\s*\?/);
      });

      it(`${file} offers a retry out of the failure`, () => {
        // Every one of these pages was a dead end before: the only way past a
        // failed read was to kill the app.
        expect(src).toContain("CatalogStatus");
      });
    }

    // `channelState` reads `configured` straight off the listing, so a failed
    // listing used to render 「尚未配置」 for a channel that may well be
    // connected. Each card carries its own state instead of the page blanking.
    it("gives each agent channel card its own read state", () => {
      const src = code("app/(app)/[workspace]/more/agents/[id]/integrations.tsx");
      expect(src).toMatch(/channelReads/);
      expect(src).toContain("loadState");
      expect(src).toMatch(/loadState === "error"/);
    });
  });

  describe("pickers", () => {
    for (const file of PICKER_SURFACES) {
      const src = code(file);

      it(`${file} reads its directories through catalogRead`, () => {
        expect(src).toContain("catalogRead");
      });

      it(`${file} never defaults raw query data to an empty array`, () => {
        // The exact construct from the bug report: the `= []` default is what
        // made a failed read indistinguishable from an empty workspace.
        expect(src).not.toMatch(/data:\s*\w+\s*=\s*\[\]/);
      });

      it(`${file} decides its empty slot instead of assuming it`, () => {
        expect(src).toContain("CatalogEmptySlot");
      });
    }
  });

  describe("property catalog", () => {
    for (const { file, hook } of PROPERTY_SURFACES) {
      const src = code(file);

      it(`${file} reads the catalog through ${hook}`, () => {
        expect(src).toContain(hook);
      });

      it(`${file} never defaults the raw catalog data to an empty array`, () => {
        expect(src).not.toMatch(/data:\s*\w+\s*=\s*\[\]/);
        expect(src).not.toMatch(/catalog\s*=\s*useQuery\([\s\S]*?\}\)\.data/);
      });
    }

    it("keeps the shared status painter as the only error/empty renderer", () => {
      for (const { file } of PROPERTY_SURFACES) {
        expect(code(file)).toContain("PropertyCatalogStatus");
      }
    });
  });

  it("gives the failure a retry, not just a message", () => {
    // One implementation now serves both families, so the retry is asserted
    // where it lives rather than per caller.
    const status = code("components/catalog/catalog-status.tsx");
    expect(status).toContain("onRetry");
    expect(status).toContain("common.retry");

    // The property-flavoured name is an alias, not a second implementation —
    // two implementations of one truth is how the second half of a bug family
    // survives.
    const alias = code("components/property/property-catalog-status.tsx");
    expect(alias).toContain("CatalogStatus");
    expect(alias).not.toContain("ActivityIndicator");
  });

  it("never reports an absence without having settled the read", () => {
    // The one sentence that must never be reachable from a non-settled read.
    // `CatalogEmptySlot` resolves the verdict from the states handed to it, so
    // the decision lives in exactly one place and no caller can skip it by
    // writing its own `if (query)` branch.
    const slot = code("components/catalog/catalog-status.tsx");
    expect(slot).toContain("resolveCatalogEmpty");
    expect(slot).toContain("verdict.kind");
  });

  it("has no picker left claiming 'no matches' outside the shared slot", () => {
    // A surface that still hand-rolls `t("picker.noMatches")` beside its own
    // list is one refactor away from re-collapsing the states, because the
    // string is the *only* thing telling the user which of the three situations
    // they are in. Any file that renders that string next to a list must be
    // routing through the shared slot.
    //
    // No surface needs an exemption any more. `FilterPropertyPickerBody` used
    // to render `picker.noMatches` beside a list with no search box; its copy
    // now names the actual fact ("this property has no options") instead.
    const ALLOWED = new Set(["components/catalog/catalog-status.tsx"]);
    const offenders: string[] = [];
    for (const rel of globSync("{components,app}/**/*.{ts,tsx}", {
      cwd: APP_ROOT,
      exclude: (name) => name.endsWith(".test.ts") || name.endsWith(".test.tsx"),
    })) {
      if (ALLOWED.has(rel)) continue;
      const src = code(rel);
      if (
        src.includes('t("picker.noMatches")') &&
        (src.includes("ListEmptyComponent") || src.includes('kind: "empty"'))
      ) {
        offenders.push(rel);
      }
    }
    expect(offenders.sort()).toEqual([]);
  });
});
