import { describe, expect, it } from "vitest";
import {
  batchFormChanged,
  hasInheritedStatus,
  hasRecoverableIntent,
  normalizedBatchStatus,
  type BatchComparableDraft,
} from "./new-issue-batch-continuation";

/**
 * A continuation baseline: what `resetForNextIssue` leaves behind for the next
 * issue of a batch — everything blanked except the two inherited fields.
 */
const baseline = (over: Partial<BatchComparableDraft> = {}): BatchComparableDraft => ({
  title: "",
  description: "",
  status: "in_progress",
  priority: "none",
  dueDate: null,
  startDate: null,
  labels: [],
  project: null,
  propertyValues: {},
  assignee: { type: "member", id: "u1" },
  ...over,
});

describe("batchFormChanged", () => {
  it("reports an untouched continuation as unchanged", () => {
    expect(batchFormChanged(baseline(), baseline())).toBe(false);
  });

  it("reports an equal-by-value rebuild as unchanged", () => {
    // The store rebuilds every object on each write, so an untouched draft
    // arrives with a NEW labels array / project object every time. Identity
    // comparison would call that an edit and keep a continuation alive
    // forever.
    const current = baseline({
      labels: [{ id: "la-1" }],
      assignee: { type: "member", id: "u1" },
      project: { id: "pr-1", name: "P" },
      propertyValues: { prop1: "a" },
    });
    const base = baseline({
      labels: [{ id: "la-1" }],
      assignee: { type: "member", id: "u1" },
      project: { id: "pr-1", name: "P" },
      propertyValues: { prop1: "a" },
    });
    expect(batchFormChanged(current, base)).toBe(false);
  });

  it("ignores property-value key order", () => {
    // Insertion order is not under the user's control; two maps with the same
    // entries are the same selection.
    const current = baseline({ propertyValues: { a: "1", b: "2" } });
    const base = baseline({ propertyValues: { b: "2", a: "1" } });
    expect(batchFormChanged(current, base)).toBe(false);
  });

  it("treats null and undefined as the same 'no value'", () => {
    // `project` is `undefined` in the reset shape and `null` in the store.
    const current = baseline({ project: null });
    const base = baseline({ project: undefined });
    expect(batchFormChanged(current, base)).toBe(false);
  });

  it.each([
    ["title", { title: "A real title" }],
    ["description", { description: "body" }],
    ["status", { status: "done" }],
    ["priority", { priority: "urgent" }],
    ["dueDate", { dueDate: "2026-11-01" }],
    ["startDate", { startDate: "2026-11-01" }],
    ["labels", { labels: [{ id: "la-1" }] }],
    ["project", { project: { id: "pr-1" } }],
    ["propertyValues", { propertyValues: { p: "v" } }],
    ["assignee", { assignee: { type: "agent", id: "ag-1" } }],
  ] as Array<[string, Partial<BatchComparableDraft>]>)(
    "reports a changed %s as an edit",
    (_field, patch) => {
      expect(batchFormChanged(baseline(patch), baseline())).toBe(true);
    },
  );

  it("ignores fields a mode switch can rewrite", () => {
    // `prompt` / `agentActor` / `mode` are outside the comparable shape on
    // purpose: switching to the agent form assist-seeds a prompt without the
    // user editing this form. Web compares `{shared, manual}` only.
    const widened = baseline() as BatchComparableDraft & { prompt?: string };
    widened.prompt = "seeded by a mode switch";
    expect(batchFormChanged(widened, baseline())).toBe(false);
  });

  it("does not confuse an array with an object of the same shape", () => {
    const current = baseline({ labels: [{ id: "a" }] });
    const base = baseline({ labels: { 0: { id: "a" } } as unknown as unknown[] });
    expect(batchFormChanged(current, base)).toBe(true);
  });

  it("does not confuse labels of equal length but different ids", () => {
    const current = baseline({ labels: [{ id: "a" }] });
    const base = baseline({ labels: [{ id: "b" }] });
    expect(batchFormChanged(current, base)).toBe(true);
  });
});

describe("hasInheritedStatus", () => {
  it("is true for an untouched continuation", () => {
    expect(hasInheritedStatus(baseline(), baseline())).toBe(true);
  });

  it("is false once the user edits anything", () => {
    expect(hasInheritedStatus(baseline({ title: "x" }), baseline())).toBe(false);
  });

  it("is false without a baseline", () => {
    // No live continuation means there is nothing inherited to normalize —
    // the common case of an ordinary draft.
    expect(hasInheritedStatus(baseline(), null)).toBe(false);
    expect(hasInheritedStatus(baseline(), undefined)).toBe(false);
  });
});

describe("normalizedBatchStatus", () => {
  it("returns an untouched continuation to the create default", () => {
    // This is what gets WRITTEN to disk, so a reload does not present the
    // inherited status as a choice the user made.
    expect(normalizedBatchStatus(baseline(), baseline(), "todo")).toBe("todo");
  });

  it("keeps a status the user changed to", () => {
    const current = baseline({ status: "done" });
    expect(normalizedBatchStatus(current, baseline({ status: "in_progress" }), "todo")).toBe("done");
  });

  it("keeps the inherited status when the user changed something else", () => {
    // Editing the title ends the "untouched" state, so the status stops being
    // inherited and is preserved as part of a real draft.
    const current = baseline({ title: "Second issue" });
    expect(normalizedBatchStatus(current, baseline(), "todo")).toBe("in_progress");
  });

  it("is a no-op without a baseline", () => {
    expect(normalizedBatchStatus(baseline(), null, "todo")).toBe("in_progress");
  });
});

describe("hasRecoverableIntent", () => {
  it("is true whenever there is real content", () => {
    expect(hasRecoverableIntent(baseline({ title: "x" }), null, true)).toBe(true);
  });

  it("is false for an untouched continuation", () => {
    // The point of the whole baseline: a batch the user never typed into must
    // not leave a phantom "unfinished draft" dot behind.
    expect(hasRecoverableIntent(baseline(), baseline(), false)).toBe(false);
  });

  it("is true for a continuation the user edited", () => {
    expect(hasRecoverableIntent(baseline({ priority: "high" }), baseline(), false)).toBe(true);
  });

  it("falls back to plain content without a baseline", () => {
    expect(hasRecoverableIntent(baseline(), null, false)).toBe(false);
    expect(hasRecoverableIntent(baseline(), null, true)).toBe(true);
  });
});
