/**
 * Wiring ratchet for the swimlane's batch parent resolution (MYS-2156).
 *
 * Mobile's vitest lane is Node-only (see vitest.config.ts) — no RN renderer —
 * so `data/api-issues-by-ids.test.ts` proving the batch CHUNKS says nothing
 * about whether the swimlane actually calls it. That gap is the one this
 * iteration exists to close: the fan-out was never a wrong answer, it was N
 * requests, so a correct chunker nobody wired up would leave the behaviour
 * exactly as it was and every other test here green.
 *
 * The assertions are structural on purpose:
 *
 *   1. The view resolves parents through the batch query.
 *   2. It no longer resolves them per-parent (`useQueries` over
 *      `issueDetailOptions`), which is the fan-out itself.
 *   3. The id list is SORTED before it is used, because those ids are the
 *      query key — an unsorted list re-keys the same question every render.
 *   4. `knownParentIds` is still built from the resolved map's keys, so the
 *      orphan-lane rule (a child whose parent is unresolved) is unchanged.
 *   5. The loading gate reads the single batch query rather than "any of N".
 *
 * Comments are stripped before matching so a comment quoting a construct can
 * neither satisfy nor trip an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");
const VIEW = "components/issue/swimlane-view.tsx";

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("swimlane batch parent resolution wiring", () => {
  const view = code(VIEW);

  it("resolves parents through the batch query", () => {
    expect(view).toContain("issuesByIdsOptions(wsId, parentIds)");
  });

  it("no longer fans out one detail request per parent", () => {
    // The fan-out was `useQueries(parentIds.map((id) =>
    // issueDetailOptions(wsId, id)))`. Both halves must stay gone: the
    // per-parent query builder and the N-query hook that drove it.
    expect(view).not.toContain("issueDetailOptions");
    expect(view).not.toContain("useQueries");
  });

  it("sorts the id list before it becomes the query key", () => {
    // `parentIds` is both the request and the cache key, so the sort is what
    // keeps the key stable across renders, not a cosmetic detail.
    expect(view).toMatch(/\[\.\.\.ids\]\.sort\(\)/);
  });

  it("still derives knownParentIds from the resolved parents", () => {
    // The orphan-lane rule depends on this: a parent absent from the map means
    // "not loaded", which pins its children to the orphan lane for that frame.
    expect(view).toContain("knownParentIds: new Set(parentById.keys())");
  });

  it("gates the loading state on the single batch query", () => {
    expect(view).toContain('grouping === "parent" && parentQuery.isLoading');
  });

  it("passes a stable empty map before the batch resolves", () => {
    // A fresh `new Map()` per render would rebuild every lane each frame.
    expect(view).toContain("parentQuery.data ?? EMPTY_PARENT_MAP");
  });

  it("never fabricates a parent the batch did not return", () => {
    // The failure this guards is silence, not a crash: if the view built a
    // placeholder entry for every requested id — which is what "the batch came
    // back empty, so make the parents known anyway" looks like — then a parent
    // the server never resolved would still promote a lane, labelled with the
    // raw uuid and `undefined · undefined`. The child would leave the pinned
    // orphan lane (where a reader can see it is unresolved) and appear under a
    // lane that names nothing. So the id list must never seed the map: only
    // the batch RESPONSE may.
    expect(view).not.toMatch(/parentIds\.(map|forEach|reduce)\(/);
    expect(view).not.toMatch(/new Map\(\s*parentIds/);
  });
});
