/**
 * Unit tests for the agents-list search + sort helpers (iteration 129,
 * MYS-1060). Mirrors web's agents-page comparators
 * (packages/views/agents/components/agents-page.tsx:906-936) and its search
 * predicate (:167-176), plus mobile's archived-last tier.
 */
import { describe, expect, it } from "vitest";
import type { Agent } from "@multica/core/types";
import {
  AGENT_SORT_DEFAULT_DIRECTION,
  lastActiveDaysAgo,
  matchesAgentSearch,
  sortAgentRows,
  type AgentSortInput,
} from "./filter-agents";
import type { AgentActivity } from "./agent-activity";

function row(
  id: string,
  overrides: Partial<AgentSortInput> & { name?: string; created?: string } = {},
): AgentSortInput & { id: string } {
  return {
    id,
    agent: {
      name: overrides.name ?? id,
      created_at: overrides.created ?? "2026-01-01T00:00:00Z",
    } as Agent,
    archived: overrides.archived ?? false,
    runCount: overrides.runCount ?? 0,
    lastActiveDays: overrides.lastActiveDays ?? null,
  };
}

const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id);

describe("matchesAgentSearch", () => {
  const agent = (name: string, description?: string) =>
    ({ name, description }) as Pick<Agent, "name" | "description">;

  it("an empty / whitespace query matches everything", () => {
    expect(matchesAgentSearch(agent("Deploy bot"), "")).toBe(true);
    expect(matchesAgentSearch(agent("Deploy bot"), "   ")).toBe(true);
  });

  it("matches name and description case-insensitively", () => {
    const a = agent("Deploy Bot", "Ships the web app");
    expect(matchesAgentSearch(a, "deploy")).toBe(true);
    expect(matchesAgentSearch(a, "WEB APP")).toBe(true);
    expect(matchesAgentSearch(a, "missing")).toBe(false);
  });

  it("matches pinyin initials on name and description", () => {
    const a = agent("部署机器人", "发布前端");
    expect(matchesAgentSearch(a, "bsjqr")).toBe(true);
    expect(matchesAgentSearch(a, "fbqd")).toBe(true);
  });

  it("does not match when there is no description", () => {
    expect(matchesAgentSearch(agent("Deploy bot"), "web")).toBe(false);
  });
});

describe("lastActiveDaysAgo", () => {
  const activity = (totals: number[]): AgentActivity => ({
    buckets: totals.map((total) => ({ total, failed: 0 })),
    daysSinceCreated: totals.length,
  });

  it("counts back from the newest bucket", () => {
    expect(lastActiveDaysAgo(activity([0, 0, 3, 0, 0]))).toBe(2);
    expect(lastActiveDaysAgo(activity([1, 0, 0]))).toBe(2);
  });

  it("returns null when nothing ran in the window", () => {
    expect(lastActiveDaysAgo(activity([0, 0, 0]))).toBeNull();
    expect(lastActiveDaysAgo(null)).toBeNull();
  });
});

describe("sortAgentRows", () => {
  it("sorts by name in both directions", () => {
    const rows = [row("b", { name: "beta" }), row("a", { name: "Alpha" })];
    expect(ids(sortAgentRows(rows, "name", "asc"))).toEqual(["a", "b"]);
    expect(ids(sortAgentRows(rows, "name", "desc"))).toEqual(["b", "a"]);
  });

  it("sorts by creation time in both directions", () => {
    const rows = [
      row("new", { created: "2026-05-01T00:00:00Z" }),
      row("old", { created: "2026-01-01T00:00:00Z" }),
    ];
    expect(ids(sortAgentRows(rows, "created", "asc"))).toEqual(["old", "new"]);
    expect(ids(sortAgentRows(rows, "created", "desc"))).toEqual(["new", "old"]);
  });

  it("sorts by run count with a name tiebreak (web parity)", () => {
    const rows = [
      row("low", { name: "z", runCount: 1 }),
      row("high", { name: "y", runCount: 9 }),
      row("tie-b", { name: "b", runCount: 5 }),
      row("tie-a", { name: "a", runCount: 5 }),
    ];
    expect(ids(sortAgentRows(rows, "runs", "desc"))).toEqual([
      "high",
      "tie-a",
      "tie-b",
      "low",
    ]);
  });

  it("lastActive desc = most recent first; never-active is the oldest end", () => {
    const rows = [
      row("stale", { lastActiveDays: 12 }),
      row("never"),
      row("fresh", { lastActiveDays: 0 }),
    ];
    expect(ids(sortAgentRows(rows, "lastActive", "desc"))).toEqual([
      "fresh",
      "stale",
      "never",
    ]);
    // asc = least recently active first, and "never" is the oldest end —
    // web's comparator does exactly this (see the module doc).
    expect(ids(sortAgentRows(rows, "lastActive", "asc"))).toEqual([
      "never",
      "stale",
      "fresh",
    ]);
  });

  it("lastActive breaks ties on run count, then name", () => {
    const rows = [
      row("few", { name: "a", lastActiveDays: 1, runCount: 1 }),
      row("many", { name: "z", lastActiveDays: 1, runCount: 7 }),
    ];
    expect(ids(sortAgentRows(rows, "lastActive", "desc"))).toEqual([
      "many",
      "few",
    ]);
  });

  it("keeps archived rows in a trailing tier whatever the sort says", () => {
    const rows = [
      row("archived-z", { name: "zzz", archived: true }),
      row("active-a", { name: "aaa" }),
      row("archived-a", { name: "aaa", archived: true }),
    ];
    expect(ids(sortAgentRows(rows, "name", "asc"))).toEqual([
      "active-a",
      "archived-a",
      "archived-z",
    ]);
    expect(ids(sortAgentRows(rows, "name", "desc"))).toEqual([
      "active-a",
      "archived-z",
      "archived-a",
    ]);
  });

  it("does not mutate the input array", () => {
    const rows = [row("b", { name: "b" }), row("a", { name: "a" })];
    sortAgentRows(rows, "name", "asc");
    expect(ids(rows)).toEqual(["b", "a"]);
  });
});

describe("AGENT_SORT_DEFAULT_DIRECTION", () => {
  it("matches web's per-field defaults", () => {
    expect(AGENT_SORT_DEFAULT_DIRECTION).toEqual({
      lastActive: "desc",
      name: "asc",
      runs: "desc",
      created: "desc",
    });
  });
});
