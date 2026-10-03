/**
 * Wiring guard for the property-catalog four-state read (MYS-1892).
 *
 * Mobile's vitest lane is Node-only (see vitest.config.ts) — there is no RN
 * renderer, so `resolvePropertyCatalogState` being correct proves nothing
 * about what the surfaces do with it. The regression this pins is exactly the
 * one a helper-level test cannot see: a caller destructures
 * `{ data: properties = [] }` and branches on `properties.length === 0`, which
 * folds "still loading" and "request failed" into "the workspace has none".
 *
 * Two assertions per surface, because either half alone is passable:
 *
 *   1. The surface reads the catalog through a hook that carries state —
 *      otherwise there is no state to render.
 *   2. The surface does not destructure the raw query `data` with an empty
 *      default — the specific construct that collapsed the states.
 *
 * Comments are stripped before matching, so a comment that quotes the banned
 * call cannot satisfy or trip an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Every surface that used to read the catalog through `= []`. */
const SURFACES: { file: string; hook: "useActivePropertyCatalog" | "usePropertyCatalog" }[] = [
  {
    file: "app/(app)/[workspace]/issues-filter.tsx",
    hook: "useActivePropertyCatalog",
  },
  {
    file: "app/(app)/[workspace]/issues-filter-picker.tsx",
    hook: "useActivePropertyCatalog",
  },
  {
    file: "app/(app)/[workspace]/issue/[id]/picker/properties.tsx",
    hook: "usePropertyCatalog",
  },
  {
    file: "app/(app)/[workspace]/more/properties/[id].tsx",
    hook: "usePropertyCatalog",
  },
  {
    file: "components/issue/pickers/property-value-editor.tsx",
    hook: "usePropertyCatalog",
  },
];

describe("property catalog four-state wiring", () => {
  for (const { file, hook } of SURFACES) {
    describe(file, () => {
      const src = code(file);

      it(`reads the catalog through ${hook}`, () => {
        expect(src).toContain(hook);
      });

      it("never defaults the raw catalog data to an empty array", () => {
        // The exact construct from the bug report: the `= []` default is what
        // made a failed read indistinguishable from an empty workspace.
        expect(src).not.toMatch(/data:\s*\w+\s*=\s*\[\]/);
        expect(src).not.toMatch(/catalog\s*=\s*useQuery\([\s\S]*?\}\)\.data/);
      });
    });
  }

  it("keeps the shared status painter as the only error/empty renderer", () => {
    // A surface that resolves the state and then re-implements the branches
    // locally would drift from the copy and the retry semantics.
    for (const { file } of SURFACES) {
      const src = code(file);
      expect(src).toContain("PropertyCatalogStatus");
    }
  });

  it("gives the failure a retry, not just a message", () => {
    const status = code("components/property/property-catalog-status.tsx");
    expect(status).toContain("onRetry");
    expect(status).toContain("common.retry");
  });
});
