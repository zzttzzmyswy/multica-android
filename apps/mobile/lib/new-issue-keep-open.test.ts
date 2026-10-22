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

  it("returns priority to its create default", () => {
    // "none", not "keep whatever was just used": a batch of five tasks where
    // the first was urgent does not make the other four urgent.
    expect(reset.priority).toBe("none");
  });

  it("does NOT touch the status", () => {
    // MUL-7648. Web now keeps the just-submitted status on the next issue of
    // the batch. The reset shape simply has no status field, so a caller
    // cannot reset it here — the store's `resetForNextIssue` inherits the live
    // value instead.
    expect(reset).not.toHaveProperty("status");
    expect(Object.keys(reset)).not.toContain("status");
  });

  it("drops the project", () => {
    // Web `:400`. A project belongs to the issue being filed (MUL-5862).
    expect(reset.project).toBeUndefined();
  });

  it("does NOT drop the parent", () => {
    // MUL-7648 reversed this. Filing several sub-issues under one parent is
    // the case batching exists for, so the parent (and its stage) now survive
    // the next issue of a batch. It stays out of this shape because it lives
    // on the screen's route state, not in the draft store.
    expect(reset).not.toHaveProperty("parentIssueId");
  });

  it("does NOT touch the assignee", () => {
    // Web `:406-414` keeps it deliberately — batching five tasks for the
    // same person is the feature's main benefit. The reset object simply has
    // no assignee field, so a caller cannot clear it through this path.
    expect(reset).not.toHaveProperty("assignee");
    expect(Object.keys(reset)).not.toContain("assignee");
  });

  it("does NOT touch the stage pick", () => {
    // Stage is only meaningful relative to the parent, and the parent now
    // survives the batch (MUL-7648) — so neither is cleared. The screen's
    // parent-scoped pick store keeps the value; keeping it out of this shape
    // stops the two from disagreeing.
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
