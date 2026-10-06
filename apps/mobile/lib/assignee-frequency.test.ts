import { describe, expect, it } from "vitest";
import type { AssigneeFrequencyEntry } from "@multica/core/types";
import {
  assigneeFrequencyOf,
  buildAssigneeFrequencyMap,
  sortByAssigneeFrequency,
} from "./assignee-frequency";

const entry = (
  assignee_type: string,
  assignee_id: string,
  frequency: number,
): AssigneeFrequencyEntry => ({ assignee_type, assignee_id, frequency });

describe("buildAssigneeFrequencyMap", () => {
  it("keys by `<type>:<id>`, web's exact key shape", () => {
    const map = buildAssigneeFrequencyMap([entry("member", "u1", 7)]);
    expect(map.get("member:u1")).toBe(7);
  });

  it("keeps member and agent ids distinct even when the ids collide", () => {
    // Web's key includes the type for exactly this reason — a member id and an
    // agent id are both opaque strings and nothing guarantees they differ.
    const map = buildAssigneeFrequencyMap([
      entry("member", "abc", 1),
      entry("agent", "abc", 9),
    ]);
    expect(map.get("member:abc")).toBe(1);
    expect(map.get("agent:abc")).toBe(9);
  });

  it("drops rows missing either identifier", () => {
    const map = buildAssigneeFrequencyMap([
      entry("", "u1", 5),
      entry("member", "", 5),
      entry("member", "u1", 2),
    ]);
    expect(map.size).toBe(1);
    expect(map.get("member:u1")).toBe(2);
  });

  it("returns an empty map for an empty response", () => {
    expect(buildAssigneeFrequencyMap([]).size).toBe(0);
  });
});

describe("assigneeFrequencyOf", () => {
  it("reads 0 for an actor the endpoint never counted", () => {
    // The endpoint only returns rows it has counted, so on a fresh workspace
    // this is the common case, not an edge case.
    const map = buildAssigneeFrequencyMap([entry("member", "u1", 3)]);
    expect(assigneeFrequencyOf(map, "member", "u2")).toBe(0);
    expect(assigneeFrequencyOf(map, "agent", "u1")).toBe(0);
  });
});

describe("sortByAssigneeFrequency", () => {
  const keyOf = (row: { id: string }) => ["member", row.id] as const;

  it("orders by frequency, descending", () => {
    const map = buildAssigneeFrequencyMap([
      entry("member", "a", 1),
      entry("member", "b", 9),
      entry("member", "c", 5),
    ]);
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(sortByAssigneeFrequency(rows, map, keyOf).map((r) => r.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("keeps the caller's order within one frequency band", () => {
    // Callers pass alphabetically-sorted rows, so unity-frequency actors must
    // stay alphabetical — a picker that reshuffles equally-used actors between
    // renders is worse than one that ignores frequency entirely.
    const map = buildAssigneeFrequencyMap([entry("member", "b", 4)]);
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    expect(sortByAssigneeFrequency(rows, map, keyOf).map((r) => r.id)).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });

  it("puts every actor at 0 in the caller's order when nothing has history", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(
      sortByAssigneeFrequency(rows, new Map(), keyOf).map((r) => r.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const map = buildAssigneeFrequencyMap([entry("member", "b", 9)]);
    const rows = [{ id: "a" }, { id: "b" }];
    sortByAssigneeFrequency(rows, map, keyOf);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("sorts each actor kind by its own type's frequency", () => {
    const map = buildAssigneeFrequencyMap([
      entry("agent", "x", 100),
      entry("squad", "y", 1),
    ]);
    const rows = [
      { id: "y", type: "squad" },
      { id: "x", type: "agent" },
    ];
    const sorted = sortByAssigneeFrequency(
      rows,
      map,
      (row) => [row.type, row.id] as const,
    );
    expect(sorted.map((r) => r.id)).toEqual(["x", "y"]);
  });
});
