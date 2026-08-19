/**
 * Filter-sheet scope registry (MYS-437): the shared filter panel/picker/date
 * routes resolve their `scope` param to one of the three view stores. This
 * test pins the mapping — each scope must land on its own isolated store.
 */
import { describe, expect, it } from "vitest";
import {
  issueFilterStoreForScope,
  parseFilterScope,
} from "./issue-filter-store-registry";
import { useIssuesViewStore } from "./issues-view-store";
import { useMyIssuesViewStore } from "./my-issues-view-store";
import { useProjectIssuesViewStore } from "./project-issues-view-store";

describe("parseFilterScope", () => {
  it("maps the three sheet scopes", () => {
    expect(parseFilterScope("all")).toBe("all");
    expect(parseFilterScope("project")).toBe("project");
    expect(parseFilterScope("my")).toBe("my");
  });

  it("falls back to my for unknown / absent params", () => {
    expect(parseFilterScope(undefined)).toBe("my");
    expect(parseFilterScope("")).toBe("my");
    expect(parseFilterScope("bogus")).toBe("my");
  });
});

describe("issueFilterStoreForScope", () => {
  it("resolves each scope to its own store", () => {
    expect(issueFilterStoreForScope("all")).toBe(useIssuesViewStore);
    expect(issueFilterStoreForScope("my")).toBe(useMyIssuesViewStore);
    expect(issueFilterStoreForScope("project")).toBe(useProjectIssuesViewStore);
  });

  it("the three stores are distinct instances", () => {
    const a = issueFilterStoreForScope("all");
    const b = issueFilterStoreForScope("my");
    const c = issueFilterStoreForScope("project");
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });
});