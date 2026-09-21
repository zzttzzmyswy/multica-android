import { describe, expect, it } from "vitest";
import { maxSiblingStage, stageOptions } from "@/lib/issue-stage";

/**
 * Sub-issue stage options (iteration 173, T3), mirroring web
 * `pickers/stage-picker.tsx:14-27`.
 *
 * A stage is an ordering among SIBLINGS, so the ceiling is not a constant: it
 * has to clear the current value, the highest stage any sibling already uses,
 * and leave one slot free to create a new one. Getting this wrong is silent —
 * a family that grew past the list just stops being able to reach its own
 * stages, with no error anywhere.
 */
describe("maxSiblingStage", () => {
  it("is 0 when nobody is staged", () => {
    expect(maxSiblingStage([{ stage: null }, { stage: null }])).toBe(0);
  });

  it("is 0 for an empty family", () => {
    expect(maxSiblingStage([])).toBe(0);
  });

  it("takes the highest staged sibling", () => {
    expect(
      maxSiblingStage([{ stage: 1 }, { stage: 4 }, { stage: 2 }]),
    ).toBe(4);
  });

  it("ignores null and undefined entries", () => {
    expect(
      maxSiblingStage([{ stage: null }, { stage: undefined }, { stage: 3 }]),
    ).toBe(3);
  });
});

describe("stageOptions", () => {
  it("always offers at least Stage 1-3 plus one more", () => {
    expect(stageOptions(null)).toEqual([1, 2, 3]);
  });

  it("covers the current stage", () => {
    expect(stageOptions(5)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("covers the highest sibling stage", () => {
    // The sibling ceiling is what keeps an existing higher stage selectable
    // when editing a lower one.
    expect(stageOptions(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("leaves room for one new stage past the current maximum", () => {
    const options = stageOptions(null, 3);
    expect(options).toContain(4);
    expect(options).not.toContain(5);
  });
});
