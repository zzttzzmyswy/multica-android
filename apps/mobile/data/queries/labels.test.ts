import { describe, expect, it, vi } from "vitest";

// Data-layer tests must mock `@/data/api` (vitest.config.ts note) so the
// native fetch chain never loads — the query module only calls `api` inside
// the queryFn, which these tests never execute.
vi.mock("@/data/api", () => ({ api: {} }));

import {
  labelCatalogOptions,
  labelKeys,
  labelListOptions,
  resourceLabelsOptions,
} from "./labels";

// Query-options tests for the iteration-60 skill resource labels: the keys
// scope catalogs and attached-labels caches by resource type/id so the
// skill-detail picker never conflates with the workspace issue label list.
describe("labelKeys + catalog/resource options", () => {
  it("keeps the legacy issue-list key shape", () => {
    expect(labelKeys.all("ws-1")).toEqual(["labels", "ws-1"]);
    expect(labelListOptions("ws-1").queryKey).toEqual(["labels", "ws-1"]);
  });

  it("scopes the skill catalog under its own key", () => {
    expect(labelKeys.catalog("ws-1", "skill")).toEqual([
      "labels",
      "ws-1",
      "catalog",
      "skill",
    ]);
    const opts = labelCatalogOptions("ws-1", "skill");
    expect(opts.queryKey).toEqual(["labels", "ws-1", "catalog", "skill"]);
    expect(opts.enabled).toBe(true);
  });

  it("disables the catalog when no workspace is selected", () => {
    expect(labelCatalogOptions(null, "skill").enabled).toBe(false);
  });

  it("scopes attached labels by resource type and id", () => {
    expect(labelKeys.byResource("ws-1", "skill", "skill-1")).toEqual([
      "labels",
      "ws-1",
      "byResource",
      "skill",
      "skill-1",
    ]);
    const opts = resourceLabelsOptions("ws-1", "skill", "skill-1");
    expect(opts.queryKey).toEqual(["labels", "ws-1", "byResource", "skill", "skill-1"]);
    expect(opts.enabled).toBe(true);
  });

  it("disables attached-labels query until both workspace and id exist", () => {
    expect(resourceLabelsOptions(null, "skill", "skill-1").enabled).toBe(false);
    expect(resourceLabelsOptions("ws-1", "skill", "").enabled).toBe(false);
  });
});