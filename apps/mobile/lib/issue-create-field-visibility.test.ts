import { describe, expect, it } from "vitest";
import {
  visibleFields,
  overflowFields,
} from "./issue-create-field-visibility";

type F = "status" | "priority" | "assignee" | "project" | "due-date";

const ALL: F[] = ["status", "priority", "assignee", "project", "due-date"];
/** Agent quick-create capability pool — no status/assignee chips. */
const QUICK_POOL: F[] = ["project", "priority", "due-date"];
const MANUAL_DEFAULT: F[] = ["status", "priority", "assignee", "project"];
const QUICK_DEFAULT: F[] = ["project"];

const nothing = (): boolean => false;

describe("issue-create-field-visibility", () => {
  it("shows exactly the configured fields when none hold a value", () => {
    expect(visibleFields(ALL, MANUAL_DEFAULT, nothing)).toEqual(MANUAL_DEFAULT);
    expect(visibleFields(QUICK_POOL, QUICK_DEFAULT, nothing)).toEqual([
      "project",
    ]);
  });

  it("rules a configured field visible regardless of its value", () => {
    // status "todo" is the empty default but IS configured → still visible.
    expect(visibleFields(ALL, MANUAL_DEFAULT, (f) => f === "status")).toContain(
      "status",
    );
  });

  it("re-surfaces a hidden field that holds a value", () => {
    const holdsDueDate = (f: F): boolean => f === "due-date";
    // Manual default hides due-date; holding one brings it back inline.
    expect(visibleFields(ALL, MANUAL_DEFAULT, holdsDueDate)).toEqual([
      "status",
      "priority",
      "assignee",
      "project",
      "due-date",
    ]);
  });

  it("lists only hidden AND valueless fields in the overflow", () => {
    expect(overflowFields(ALL, MANUAL_DEFAULT, nothing)).toEqual(["due-date"]);
    expect(overflowFields(QUICK_POOL, QUICK_DEFAULT, nothing)).toEqual([
      "priority",
      "due-date",
    ]);
  });

  it("removes a hidden field from the overflow once it holds a value", () => {
    expect(overflowFields(ALL, MANUAL_DEFAULT, (f) => f === "due-date")).toEqual(
      [],
    );
  });

  it("keeps an already-visible field out of the overflow", () => {
    // Hiding nothing: with full manual config every field is visible.
    expect(overflowFields(ALL, ALL, nothing)).toEqual([]);
  });
});