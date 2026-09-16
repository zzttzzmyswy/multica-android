import { describe, expect, it } from "vitest";
import { DRAIN_MAX_ROWS, shouldDrainNextPage } from "./use-drain-issue-pages";

const base = {
  enabled: true,
  hasNextPage: true,
  isFetchingNextPage: false,
  isFetchNextPageError: false,
  loadedRows: 50,
};

describe("shouldDrainNextPage", () => {
  it("drains while another page exists", () => {
    expect(shouldDrainNextPage(base)).toBe(true);
  });

  it("stops when the view does not need the whole window (list view)", () => {
    // The linear list view uses real infinite scroll; draining there would
    // fetch every page up front and defeat the point.
    expect(shouldDrainNextPage({ ...base, enabled: false })).toBe(false);
  });

  it("stops at the end of the window", () => {
    expect(shouldDrainNextPage({ ...base, hasNextPage: false })).toBe(false);
  });

  it("does not stack a second fetch on an in-flight one", () => {
    expect(shouldDrainNextPage({ ...base, isFetchingNextPage: true })).toBe(
      false,
    );
  });

  it("gives up after a failed page instead of hammering the server", () => {
    expect(
      shouldDrainNextPage({ ...base, isFetchNextPageError: true }),
    ).toBe(false);
  });

  it("stops at the row ceiling", () => {
    expect(shouldDrainNextPage({ ...base, maxRows: 100, loadedRows: 100 })).toBe(
      false,
    );
    expect(shouldDrainNextPage({ ...base, maxRows: 100, loadedRows: 99 })).toBe(
      true,
    );
  });

  it("defaults the ceiling to the same 10k the gantt walk uses", () => {
    expect(DRAIN_MAX_ROWS).toBe(10_000);
    expect(shouldDrainNextPage({ ...base, loadedRows: DRAIN_MAX_ROWS })).toBe(
      false,
    );
  });
});
