import { describe, expect, it } from "vitest";
import {
  hiddenStatuses,
  hideOneStatus,
  isStatusHidden,
  showOneStatus,
} from "./issue-filter-slice";
import { BOARD_STATUSES } from "@/lib/issue-status-core";

/**
 * Board hidden-column state (iteration 173, T2).
 *
 * Hiding a column is expressed as the status FILTER, not as a parallel
 * "hidden" list — that is web's model (`view-store.ts:385-400`) and it is what
 * makes the hidden lane and the fetched window agree. The subtlety these cases
 * pin is the meaning of an EMPTY filter list: it means "no status
 * restriction" (show everything), which is the opposite of "hide everything",
 * so the first hide has to materialise the complement.
 */
const ALL = BOARD_STATUSES;

describe("hideOneStatus", () => {
  it("materialises the complement when nothing is filtered yet", () => {
    const next = hideOneStatus([], "todo", ALL);
    expect(next).not.toContain("todo");
    expect(next).toHaveLength(ALL.length - 1);
  });

  it("drops one status from an existing filter", () => {
    expect(hideOneStatus(["todo", "in_progress"], "todo", ALL)).toEqual([
      "in_progress",
    ]);
  });

  it("is a no-op for an already-hidden status", () => {
    expect(hideOneStatus(["todo"], "done", ALL)).toEqual(["todo"]);
  });

  it("can hide every status", () => {
    let filters: string[] = [];
    for (const status of ALL) filters = hideOneStatus(filters, status, ALL);
    expect(filters).toEqual([]);
    // The all-hidden state is "non-empty filter matching nothing" — an empty
    // list is back to meaning "show everything", which is why `hiddenStatuses`
    // is derived from the FILTER and not from the array's emptiness alone.
  });
});

describe("showOneStatus", () => {
  it("adds the status back", () => {
    expect(showOneStatus(["in_progress"], "todo")).toEqual([
      "in_progress",
      "todo",
    ]);
  });

  it("is a no-op when nothing is hidden", () => {
    // Adding to an empty list would mean "show ONLY this one" — the opposite
    // of what a restore tap means.
    expect(showOneStatus([], "todo")).toEqual([]);
  });

  it("does not duplicate an already-visible status", () => {
    expect(showOneStatus(["todo"], "todo")).toEqual(["todo"]);
  });
});

describe("hiddenStatuses", () => {
  it("is empty when no status filter is active", () => {
    expect(hiddenStatuses([])).toEqual([]);
  });

  it("is the complement of the visible set", () => {
    const hidden = hiddenStatuses(["todo", "done"]);
    expect(hidden).not.toContain("todo");
    expect(hidden).not.toContain("done");
    expect(hidden).toHaveLength(ALL.length - 2);
  });

  it("round-trips through hide/show", () => {
    const filters = hideOneStatus([], "blocked", ALL);
    expect(hiddenStatuses(filters)).toEqual(["blocked"]);
    expect(hiddenStatuses(showOneStatus(filters, "blocked"))).toEqual([]);
  });
});

describe("isStatusHidden", () => {
  it("reports every status visible when nothing is filtered", () => {
    for (const status of ALL) expect(isStatusHidden([], status)).toBe(false);
  });

  it("reports the excluded status as hidden", () => {
    expect(isStatusHidden(["todo"], "done")).toBe(true);
    expect(isStatusHidden(["todo"], "todo")).toBe(false);
  });
});
