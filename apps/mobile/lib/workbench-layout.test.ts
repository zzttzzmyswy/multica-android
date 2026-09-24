/**
 * Unit tests for the workbench layout helpers (`lib/workbench-layout.ts`) —
 * the pure half of the swimlane / list folding and the persisted bucket
 * shape. The store that persists these is tested separately in
 * `data/stores/issue-workbench-layout-store.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  collapseSections,
  isCollapsedKey,
  normalizeBuckets,
  normalizeKeyList,
  toggleCollapsedKey,
} from "./workbench-layout";

describe("toggleCollapsedKey", () => {
  it("adds an absent key at the end", () => {
    expect(toggleCollapsedKey(["a"], "b")).toEqual(["a", "b"]);
  });

  it("removes a present key", () => {
    expect(toggleCollapsedKey(["a", "b"], "a")).toEqual(["b"]);
  });

  it("does not mutate the input list", () => {
    const input = ["a"];
    toggleCollapsedKey(input, "b");
    expect(input).toEqual(["a"]);
  });

  it("round-trips a toggle back to the original set", () => {
    const once = toggleCollapsedKey([], "assignee:agent:a1");
    expect(toggleCollapsedKey(once, "assignee:agent:a1")).toEqual([]);
  });
});

describe("isCollapsedKey", () => {
  it("reads an absent bucket as nothing folded", () => {
    expect(isCollapsedKey(undefined, "status:todo")).toBe(false);
  });

  it("finds a key in the bucket", () => {
    expect(isCollapsedKey(["status:todo"], "status:todo")).toBe(true);
    expect(isCollapsedKey(["status:todo"], "status:done")).toBe(false);
  });
});

describe("normalizeKeyList", () => {
  it("reads corrupt input as nothing folded", () => {
    for (const raw of [null, undefined, "todo", 7, { a: 1 }]) {
      expect(normalizeKeyList(raw)).toEqual([]);
    }
  });

  it("drops non-string and empty entries", () => {
    expect(normalizeKeyList(["a", 3, "", null, "b"])).toEqual(["a", "b"]);
  });

  it("de-duplicates while keeping first-seen order", () => {
    expect(normalizeKeyList(["b", "a", "b"])).toEqual(["b", "a"]);
  });
});

describe("normalizeBuckets", () => {
  it("reads corrupt input as no buckets", () => {
    for (const raw of [null, undefined, [], "assignee"]) {
      expect(normalizeBuckets(raw)).toEqual({});
    }
  });

  it("keeps every bucket, including ones this surface cannot render", () => {
    // `status` is the list's bucket and `assignee` the swimlane's; a surface
    // that only renders one must not erase the other.
    expect(
      normalizeBuckets({ status: ["todo"], assignee: ["agent:a1"] }),
    ).toEqual({ status: ["todo"], assignee: ["agent:a1"] });
  });

  it("drops buckets that normalize to nothing", () => {
    expect(normalizeBuckets({ status: [], assignee: "nope" })).toEqual({});
  });

  it("normalizes each bucket's contents", () => {
    expect(normalizeBuckets({ status: ["todo", "todo", 5] })).toEqual({
      status: ["todo"],
    });
  });
});

describe("collapseSections", () => {
  const sections = [
    { key: "todo", data: [1, 2, 3] },
    { key: "done", data: [4] },
  ];

  it("empties a folded section's rows and keeps its count", () => {
    const out = collapseSections(sections, new Set(["todo"]));
    expect(out[0].data).toEqual([]);
    expect((out[0] as { count?: number }).count).toBe(3);
    expect(out[1]).toBe(sections[1]);
  });

  it("leaves every section untouched when nothing is folded", () => {
    const out = collapseSections(sections, new Set());
    expect(out[0]).toBe(sections[0]);
    expect(out[1]).toBe(sections[1]);
  });

  it("does not mutate the input sections", () => {
    collapseSections(sections, new Set(["todo"]));
    expect(sections[0].data).toEqual([1, 2, 3]);
  });
});
