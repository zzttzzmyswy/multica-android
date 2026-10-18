import { describe, expect, it } from "vitest";
import type { Project } from "@multica/core/types";
import { leadFilterOptions } from "./filter-projects";
import type { ActorNameState } from "./actor-name-state";

/**
 * The lead-filter chips' two competing requirements (iteration 256, MYS-2227).
 *
 * The chip's TEXT is an assertion about a person — an unread directory must
 * withhold it, not print `getName`'s 「Unknown Agent」. The chip's ORDER, on the
 * other hand, must be a function of the PROJECTS alone: if it followed the
 * label, the chips would reshuffle as directories answered, and on a partial
 * cache (members resolved, agents still in flight) they would interleave.
 *
 * `sortKey` is what makes both true at once. These tests pin the property
 * directly — "read progress does not change the order" — rather than pinning
 * the implementation, so a future refactor that keeps the property passes.
 */

function project(id: string, lead: { type: "member" | "agent"; id: string } | null): Project {
  return {
    id,
    workspace_id: "w1",
    title: id,
    description: null,
    status: "planned",
    priority: "medium",
    lead_type: lead?.type ?? null,
    lead_id: lead?.id ?? null,
    start_date: null,
    due_date: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    issue_count: 0,
    done_count: 0,
  } as unknown as Project;
}

/** A resolver with every name known — the warm-cache case. The names sort in
 *  the OPPOSITE order to the references on purpose (`agent:…` < `member:…`, but
 *  "Ada" > "Zoe"), so "ordered by reference" and "ordered by label" are
 *  genuinely distinguishable rather than accidentally identical. */
const ALL_NAMED = (type: "member" | "agent", id: string): ActorNameState => ({
  kind: "name",
  name: `${type === "member" ? "Ada" : "Zoe"} ${id}`,
});

/** Nothing settled — the cold-start case. */
const NOTHING_READ = (): ActorNameState => ({ kind: "unsettled" });

/** One directory settled, the other still in flight — the case that exposes a
 *  label-based sort, because half the labels exist and half do not. */
const PARTIAL = (type: "member" | "agent", id: string): ActorNameState =>
  type === "member" ? { kind: "name", name: `Ada ${id}` } : { kind: "unsettled" };

const PROJECTS = [
  project("p1", { type: "member", id: "u-zzz" }),
  project("p2", { type: "agent", id: "a-aaa" }),
  project("p3", { type: "member", id: "u-mmm" }),
  project("p4", { type: "agent", id: "a-nnn" }),
];

const order = (resolve: typeof ALL_NAMED) =>
  leadFilterOptions(PROJECTS, resolve).map((o) => o.value);

describe("a lead filter chip's text is withheld, its position is not", () => {
  it("withholds every label while nothing has answered", () => {
    const options = leadFilterOptions(PROJECTS, NOTHING_READ);
    expect(options.map((o) => o.label)).toEqual([null, null, null, null]);
    // Withholding must not drop the option: the chip keeps its slot, its
    // avatar and its tap target, and the filter it stands for still works.
    expect(options).toHaveLength(4);
  });

  it("keeps the option count independent of read progress", () => {
    // The COUNT is read off the project rows, never off a directory, so it is
    // true at every point in the read. A chip whose count changed as names
    // arrived would be reporting a read, not a filter.
    const cold = leadFilterOptions(PROJECTS, NOTHING_READ);
    const warm = leadFilterOptions(PROJECTS, ALL_NAMED);
    expect(cold.map((o) => o.count)).toEqual(warm.map((o) => o.count));
  });

  it("orders identically at every point in the read", () => {
    // THE property. Three snapshots of the same list — nothing read, half
    // read, fully read — must produce byte-identical chip order.
    expect(order(NOTHING_READ)).toEqual(order(ALL_NAMED));
    expect(order(PARTIAL)).toEqual(order(ALL_NAMED));
  });

  it("does not sort by the name even when every name is known", () => {
    // Order is the composite reference, so the sequence is the same whether or
    // not the names have arrived — that is the property the sort exists to
    // hold. The fixture's names reverse their ids, so a label-driven sort would
    // produce a different sequence; asserting the two differ is what keeps this
    // test from passing vacuously.
    const values = order(ALL_NAMED);
    expect(values).toEqual([
      "agent:a-aaa",
      "agent:a-nnn",
      "member:u-mmm",
      "member:u-zzz",
    ].sort((a, b) => a.localeCompare(b)));
    const byLabel = leadFilterOptions(PROJECTS, ALL_NAMED)
      .slice()
      .sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""))
      .map((o) => o.value);
    expect(values).not.toEqual(byLabel);
  });

  it("names the settled ones and withholds only the unsettled", () => {
    const options = leadFilterOptions(PROJECTS, PARTIAL);
    const byValue = new Map(options.map((o) => [o.value, o.label]));
    expect(byValue.get("member:u-zzz")).toBe("Ada u-zzz");
    expect(byValue.get("member:u-mmm")).toBe("Ada u-mmm");
    expect(byValue.get("agent:a-aaa")).toBeNull();
    expect(byValue.get("agent:a-nnn")).toBeNull();
  });

  it("counts repeated leads once per project", () => {
    const twice = [
      project("p1", { type: "member", id: "u-1" }),
      project("p2", { type: "member", id: "u-1" }),
      project("p3", { type: "member", id: "u-2" }),
    ];
    const options = leadFilterOptions(twice, ALL_NAMED);
    expect(options).toHaveLength(2);
    expect(options.find((o) => o.value === "member:u-1")?.count).toBe(2);
  });

  it("contributes no option for a project with no lead", () => {
    // Web's loop `continue`s on the same condition — there is no "unassigned"
    // chip, because a lead filter has no value to filter by.
    const options = leadFilterOptions(
      [...PROJECTS, project("p5", null)],
      ALL_NAMED,
    );
    expect(options).toHaveLength(4);
  });
});
