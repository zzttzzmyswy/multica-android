import { describe, expect, it } from "vitest";
import {
  nextIssueDraftReset,
  shouldKeepFormOpen,
} from "./new-issue-keep-open";
import { normalizeKeepOpen } from "./new-issue-keep-open-persist";

describe("nextIssueDraftReset", () => {
  const reset = nextIssueDraftReset({ assignee: { type: "member", id: "u1" }, stage: 3 });

  it("clears the content of the issue just filed", () => {
    expect(reset.title).toBe("");
    expect(reset.description).toBe("");
    expect(reset.prompt).toBe("");
    expect(reset.labels).toEqual([]);
    expect(reset.propertyValues).toEqual({});
    expect(reset.dueDate).toBeNull();
    expect(reset.startDate).toBeNull();
  });

  it("returns status and priority to their create defaults", () => {
    // Web `:393-394` — "todo" / "none", not "keep whatever was just used".
    // A batch of five tasks where the first was urgent does not make the
    // other four urgent.
    expect(reset.status).toBe("todo");
    expect(reset.priority).toBe("none");
  });

  it("drops the project", () => {
    // Web `:400`. A project belongs to the issue being filed (MUL-5862).
    expect(reset.project).toBeUndefined();
  });

  it("drops the parent", () => {
    // Web `:401`. A batch is not a sub-task queue: carrying the parent
    // forward files unrelated tasks under the previous issue's tree.
    expect(reset.parentIssueId).toBeUndefined();
  });

  it("does NOT touch the assignee", () => {
    // Web `:406-414` keeps it deliberately — batching five tasks for the
    // same person is the feature's main benefit. The reset object simply has
    // no assignee field, so a caller cannot clear it through this path.
    expect(reset).not.toHaveProperty("assignee");
    expect(Object.keys(reset)).not.toContain("assignee");
  });

  it("does NOT touch the stage pick", () => {
    // Stage is relative to the parent, which this reset just cleared. The
    // screen clears it through its own parent-scoped store — see the module
    // doc; keeping it out of this shape stops the two from disagreeing.
    expect(reset).not.toHaveProperty("stage");
  });
});

describe("shouldKeepFormOpen", () => {
  it("keeps the form open when the preference is on", () => {
    expect(shouldKeepFormOpen(true)).toBe(true);
  });

  it("closes the form when the preference is off", () => {
    expect(shouldKeepFormOpen(false)).toBe(false);
  });

  it("treats a non-true value as off", () => {
    // The flag arrives from persisted storage, so "truthy" is not enough —
    // a legacy string "false" must not keep the form open forever.
    expect(shouldKeepFormOpen("true" as unknown as boolean)).toBe(false);
    expect(shouldKeepFormOpen(undefined as unknown as boolean)).toBe(false);
  });
});

describe("normalizeKeepOpen", () => {
  it("reads a literal true", () => {
    expect(normalizeKeepOpen({ keepOpen: true })).toBe(true);
  });

  it("reads anything else as false", () => {
    expect(normalizeKeepOpen({ keepOpen: false })).toBe(false);
    expect(normalizeKeepOpen({ keepOpen: "true" })).toBe(false);
    expect(normalizeKeepOpen({ keepOpen: 1 })).toBe(false);
    expect(normalizeKeepOpen({})).toBe(false);
  });

  it("survives a corrupt payload", () => {
    expect(normalizeKeepOpen(null)).toBe(false);
    expect(normalizeKeepOpen(undefined)).toBe(false);
    expect(normalizeKeepOpen("nonsense")).toBe(false);
    expect(normalizeKeepOpen([true])).toBe(false);
  });
});
