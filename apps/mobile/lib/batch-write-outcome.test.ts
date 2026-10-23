import { describe, expect, it } from "vitest";
import {
  batchSelectionAfter,
  batchToastKind,
  batchWriteOutcome,
} from "./batch-write-outcome";

/**
 * The batch write's verdict. Each case below is a shape the real endpoint can
 * return, taken from `server/internal/handler/issue.go` (`BatchUpdateIssues`
 * skips per-issue failures with `continue` and reports the count it committed).
 */
describe("batchWriteOutcome", () => {
  it("calls a full commit `all`", () => {
    expect(batchWriteOutcome(3, 3)).toBe("all");
  });

  it("calls a short commit `partial`", () => {
    expect(batchWriteOutcome(5, 2)).toBe("partial");
  });

  it("treats an unreadable count as `unknown`, never `partial`", () => {
    // parseWithFallback hands back the sentinel when the response drifts; the
    // client must not invent a "0 of 5 applied" claim out of that.
    expect(batchWriteOutcome(5, null)).toBe("unknown");
  });

  it("treats a non-finite count as `unknown`", () => {
    expect(batchWriteOutcome(5, Number.NaN)).toBe("unknown");
    expect(batchWriteOutcome(5, Number.POSITIVE_INFINITY)).toBe("unknown");
  });

  it("does not call an over-count `partial`", () => {
    // Nonsense, but a number greater than the request is not evidence that a
    // row was skipped.
    expect(batchWriteOutcome(2, 3)).toBe("all");
  });

  it("an empty request cannot be partial", () => {
    expect(batchWriteOutcome(0, 0)).toBe("all");
  });

  it("a zero commit of a non-empty request is `partial`, not `all`", () => {
    expect(batchWriteOutcome(4, 0)).toBe("partial");
  });
});

describe("batchSelectionAfter", () => {
  it("exits selection mode after a full commit on a one-shot surface", () => {
    expect(batchSelectionAfter("all", true)).toBe("exit");
  });

  it("keeps the selection after a full commit on a chainable surface", () => {
    expect(batchSelectionAfter("all", false)).toBe("keep");
  });

  it("keeps the selection after a partial commit even on a one-shot surface", () => {
    // The skipped rows are the ones the user still has to act on; dropping
    // them would erase the only handle on them.
    expect(batchSelectionAfter("partial", true)).toBe("keep");
  });

  it("keeps the selection when the count could not be read", () => {
    expect(batchSelectionAfter("unknown", true)).toBe("keep");
  });
});

describe("batchToastKind", () => {
  it("partial is a warning, not an error", () => {
    expect(batchToastKind("partial")).toBe("warning");
  });

  it("a full commit is success", () => {
    expect(batchToastKind("all")).toBe("success");
  });

  it("an unreadable count is still success — nothing was reported as skipped", () => {
    expect(batchToastKind("unknown")).toBe("success");
  });
});
