import { describe, it, expect } from "vitest";
import { consecutiveRuns, pad2, timeParts } from "./schedule-editor-model";

describe("schedule-editor-model", () => {
  it("finds maximal consecutive runs in an ascending day set", () => {
    expect(consecutiveRuns([1, 2, 3, 4, 5])).toEqual([[1, 5]]);
    expect(consecutiveRuns([0, 1, 2, 4])).toEqual([
      [0, 2],
      [4, 4],
    ]);
    expect(consecutiveRuns([0, 2, 4, 6])).toEqual([
      [0, 0],
      [2, 2],
      [4, 4],
      [6, 6],
    ]);
    expect(consecutiveRuns([5, 1, 3, 1])).toEqual([
      [1, 1],
      [3, 3],
      [5, 5],
    ]);
  });

  it("pads to two digits and parses HH:MM", () => {
    expect(pad2(5)).toBe("05");
    expect(pad2(23)).toBe("23");
    expect(timeParts("09:30")).toEqual({ hour: 9, minute: 30 });
    expect(timeParts("23:00")).toEqual({ hour: 23, minute: 0 });
  });
});