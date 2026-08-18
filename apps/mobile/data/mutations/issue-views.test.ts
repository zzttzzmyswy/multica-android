/**
 * Issue-view mutation cache-patch tests (iteration-65). The optimistic
 * three-step contract (snapshot → patch → settle invalidate) is covered at
 * the pure-function level here — the hooks themselves only wire these to the
 * query cache, which the Node vitest lane has no renderer for.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/data/api", () => ({ api: {} }));

import {
  applyViewUpdatePatch,
  appendViewToList,
  patchViewInList,
  removeViewFromList,
  replaceViewInList,
} from "./issue-views";

const BASE = {
  id: "view-1",
  workspace_id: "ws-1",
  owner_id: "user-1",
  name: "Backlog",
  scope_type: "workspace" as const,
  scope_id: null,
  scope_variant: null,
  visibility: "private",
  definition_version: 1,
  query: { statusFilters: ["todo"] },
  display: { viewMode: "list" },
  revision: 3,
  created_at: "2026-08-18T00:00:00Z",
  updated_at: "2026-08-18T00:00:00Z",
};

describe("applyViewUpdatePatch", () => {
  it("merges only defined fields and never advances revision", () => {
    const out = applyViewUpdatePatch(BASE, {
      name: "Renamed",
      visibility: "workspace",
      query: { statusFilters: ["done"] },
    });
    expect(out.name).toBe("Renamed");
    expect(out.visibility).toBe("workspace");
    expect(out.query).toEqual({ statusFilters: ["done"] });
    expect(out.revision).toBe(3);
    expect(out.display).toEqual({ viewMode: "list" }); // untouched
  });

  it("explicit null scope_variant clears it while undefined keeps it", () => {
    expect(
      applyViewUpdatePatch(BASE, { scope_variant: null }).scope_variant,
    ).toBeNull();
    expect(
      applyViewUpdatePatch(BASE, { scope_variant: undefined }).scope_variant,
    ).toBeNull(); // BASE has null already
  });
});

describe("patchViewInList / replaceViewInList / removeViewFromList", () => {
  const list = [BASE, { ...BASE, id: "view-2", name: "Hot" }];

  it("patches the target row only", () => {
    const out = patchViewInList(list, "view-2", { name: "Hotter" });
    expect(out?.[1].name).toBe("Hotter");
    expect(out?.[0].name).toBe("Backlog");
  });

  it("returns the list unchanged when the id is absent", () => {
    expect(patchViewInList(list, "nope", { name: "x" })).toBe(list);
  });

  it("replaces wholesale with the server-confirmed view", () => {
    const server = { ...BASE, revision: 4, name: "ServerName" };
    const out = replaceViewInList(list, server);
    expect(out?.[0].revision).toBe(4);
    expect(out?.[0].name).toBe("ServerName");
  });

  it("removes the deleted view", () => {
    const out = removeViewFromList(list, "view-1");
    expect(out?.map((v) => v.id)).toEqual(["view-2"]);
  });

  it("tolerates an undefined list (cache miss)", () => {
    expect(patchViewInList(undefined, "view-1", { name: "x" })).toBeUndefined();
    expect(removeViewFromList(undefined, "view-1")).toBeUndefined();
    expect(replaceViewInList(undefined, BASE)).toBeUndefined();
  });
});

describe("appendViewToList", () => {
  it("appends a new view without duplicating", () => {
    const out = appendViewToList([BASE], { ...BASE, id: "view-9" });
    expect(out?.map((v) => v.id)).toEqual(["view-1", "view-9"]);
    expect(appendViewToList([BASE], BASE)?.map((v) => v.id)).toEqual([
      "view-1",
    ]);
  });

  it("tolerates a missing list", () => {
    expect(appendViewToList(undefined, BASE)).toBeUndefined();
  });
});