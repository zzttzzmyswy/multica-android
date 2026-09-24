import { describe, expect, it } from "vitest";
import type { Label } from "@multica/core/types";
import { filterLabels, labelScopeOf, LABEL_SCOPES } from "./labels-display";

function label(overrides: Partial<Label>): Label {
  return {
    id: "label-1",
    workspace_id: "workspace-1",
    resource_type: "issue",
    name: "Bug",
    description: "Something is broken",
    color: "#ef4444",
    usage_count: 0,
    created_at: "2026-06-15T08:00:00Z",
    updated_at: "2026-06-15T08:00:00Z",
    ...overrides,
  };
}

describe("labelScopeOf", () => {
  it("reads an explicit skill label as the skill catalog", () => {
    expect(labelScopeOf(label({ resource_type: "skill" }))).toBe("skill");
  });

  it("falls back to issue for legacy rows with no resource_type", () => {
    // Rows written before the column existed come back without it; the server
    // treats an unscoped list as issue, so the client must agree.
    expect(labelScopeOf(label({ resource_type: undefined }))).toBe("issue");
  });

  it("keeps the two manageable catalogs and drops agent labels", () => {
    expect([...LABEL_SCOPES]).toEqual(["issue", "skill"]);
  });
});

describe("filterLabels", () => {
  it("returns the whole scope when the query is blank or whitespace", () => {
    const labels = [label({ id: "a" }), label({ id: "b", resource_type: "skill" })];
    expect(filterLabels(labels, "issue", "").map((l) => l.id)).toEqual(["a"]);
    expect(filterLabels(labels, "issue", "   ").map((l) => l.id)).toEqual(["a"]);
  });

  it("never mixes the two catalogs", () => {
    const labels = [
      label({ id: "issue-1", name: "Bug" }),
      label({ id: "skill-1", name: "Bug", resource_type: "skill" }),
    ];
    expect(filterLabels(labels, "issue", "bug").map((l) => l.id)).toEqual(["issue-1"]);
    expect(filterLabels(labels, "skill", "bug").map((l) => l.id)).toEqual(["skill-1"]);
  });

  it("matches the name case-insensitively", () => {
    const labels = [label({ name: "Performance" })];
    expect(filterLabels(labels, "issue", "PERF")).toHaveLength(1);
  });

  it("matches the description too, mirroring web's filter", () => {
    const labels = [label({ name: "Bug", description: "Crash on cold start" })];
    expect(filterLabels(labels, "issue", "cold start")).toHaveLength(1);
  });

  it("tolerates a label with no description", () => {
    const labels = [label({ name: "Bug", description: undefined })];
    expect(filterLabels(labels, "issue", "bug")).toHaveLength(1);
    expect(filterLabels(labels, "issue", "zzz")).toHaveLength(0);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterLabels([label({})], "issue", "nope")).toEqual([]);
  });
});
