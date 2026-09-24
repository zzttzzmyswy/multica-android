/**
 * Cache-patch test for the repository edit mutation (`useUpdateWorkspaceRepo`).
 *
 * The hook itself only wires `replaceRepoAt` to the query cache, which the
 * Node vitest lane has no renderer for — the arithmetic is what can be wrong
 * in a way nothing on screen makes obvious: the server addresses a repository
 * by POSITION (there is no repo id), so an off-by-one rewrites a different
 * repository and the server accepts it.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/data/api", () => ({ api: {} }));
// The mutation module binds to the workspace store, which loads
// expo-secure-store at import time (no-op in the Node lane).
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import type { WorkspaceRepo } from "@multica/core/types";
import { replaceRepoAt } from "./repositories";

const repos: WorkspaceRepo[] = [
  { url: "https://github.com/acme/one.git", description: "one" },
  { url: "https://github.com/acme/two.git" },
  { url: "https://github.com/acme/three.git", description: "three" },
];

describe("replaceRepoAt", () => {
  it("replaces only the addressed row", () => {
    const next = replaceRepoAt(repos, 1, {
      url: "https://github.com/acme/renamed.git",
      description: "renamed",
    });
    expect(next).toEqual([
      repos[0],
      { url: "https://github.com/acme/renamed.git", description: "renamed" },
      repos[2],
    ]);
  });

  it("can clear a description by sending the row without one", () => {
    const next = replaceRepoAt(repos, 0, { url: repos[0]!.url });
    expect(next?.[0]).toEqual({ url: repos[0]!.url });
    expect("description" in (next?.[0] ?? {})).toBe(false);
  });

  it("returns null for an index past the end", () => {
    expect(replaceRepoAt(repos, 3, { url: "x" })).toBeNull();
  });

  it("returns null for a negative or non-integer index", () => {
    expect(replaceRepoAt(repos, -1, { url: "x" })).toBeNull();
    expect(replaceRepoAt(repos, 1.5, { url: "x" })).toBeNull();
  });

  it("returns null on an empty list rather than inventing a row", () => {
    expect(replaceRepoAt([], 0, { url: "x" })).toBeNull();
  });

  it("does not mutate the input array", () => {
    replaceRepoAt(repos, 0, { url: "x" });
    expect(repos[0]!.url).toBe("https://github.com/acme/one.git");
  });
});
