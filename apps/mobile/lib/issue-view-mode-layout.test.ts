import { describe, expect, it } from "vitest";
import { issueViewModeColumns } from "./issue-view-mode-layout";

describe("issue view-mode selector", () => {
  it("fits all five default-size labels at 320 dp", () => {
    expect(issueViewModeColumns(320, 1)).toBe(5);
  });

  it("reduces the columns rather than truncating the large-size labels", () => {
    expect(issueViewModeColumns(320, 1.3)).toBe(3);
    expect(issueViewModeColumns(320, 2)).toBe(2);
    expect(issueViewModeColumns(320, 3)).toBe(1);
  });

  it("keeps the single-row layout on wide windows and reserves the regular touch width", () => {
    expect(issueViewModeColumns(760, 1.8)).toBe(5);
    expect(issueViewModeColumns(300, 0.8)).toBe(3);
  });
});
