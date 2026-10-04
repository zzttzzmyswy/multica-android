/**
 * Unit tests for the agents-list search + sort helpers (iteration 129,
 * MYS-1060). Mirrors web's agents-page comparators
 * (packages/views/agents/components/agents-page.tsx:906-936) and its search
 * predicate (:167-176), plus mobile's archived-last tier.
 */
import { describe, expect, it } from "vitest";
import type { Agent } from "@multica/core/types";
import type { AgentAvailability } from "@multica/core/agents";
import {
  AGENT_FILTER_AVAILABILITY_VALUES,
  AGENT_SORT_DEFAULT_DIRECTION,
  buildAgentFilterOptions,
  countActiveAgentFilters,
  EMPTY_AGENT_FILTERS,
  lastActiveDaysAgo,
  matchesAgentSearch,
  rowMatchesAgentFilters,
  sortAgentRows,
  type AgentFilterRow,
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

// ---------------------------------------------------------------------------
// Multi-dimension filters (iteration 181, MYS-1564 / G27).
//
// The predicate is a clause-for-clause port of web's `rowMatchesFilters`
// (packages/views/agents/components/agents-page.tsx:184-226), so these cases
// are written against that function's contract: AND across dimensions, OR
// within one, empty array = inactive.
// ---------------------------------------------------------------------------
function filterRow(overrides: {
  id?: string;
  availability?: AgentAvailability | null;
  runtimeId?: string;
  ownerId?: string | null;
  model?: string;
  name?: string;
  description?: string | null;
}): AgentFilterRow {
  return {
    agent: {
      name: overrides.name ?? overrides.id ?? "agent",
      description: overrides.description ?? "",
      runtime_id: overrides.runtimeId ?? "rt-1",
      owner_id: overrides.ownerId === undefined ? "u-1" : overrides.ownerId,
      model: overrides.model ?? "claude",
    },
    availability:
      overrides.availability === undefined ? "online" : overrides.availability,
  };
}

describe("rowMatchesAgentFilters", () => {
  it("empty filters match every row", () => {
    const row = filterRow({});
    expect(rowMatchesAgentFilters(row, EMPTY_AGENT_FILTERS, "")).toBe(true);
  });

  it("search still applies first (AND with the dimensions)", () => {
    const row = filterRow({ name: "Deploy bot" });
    expect(rowMatchesAgentFilters(row, EMPTY_AGENT_FILTERS, "deploy")).toBe(true);
    expect(rowMatchesAgentFilters(row, EMPTY_AGENT_FILTERS, "missing")).toBe(false);
  });

  it("matches within one dimension as OR", () => {
    const online = filterRow({ availability: "online" });
    const offline = filterRow({ availability: "offline" });
    const filters = {
      ...EMPTY_AGENT_FILTERS,
      availability: ["online", "offline"],
    };
    expect(rowMatchesAgentFilters(online, filters, "")).toBe(true);
    expect(rowMatchesAgentFilters(offline, filters, "")).toBe(true);
  });

  it("ANDs across dimensions", () => {
    const row = filterRow({ availability: "online", model: "claude" });
    expect(
      rowMatchesAgentFilters(
        row,
        { ...EMPTY_AGENT_FILTERS, availability: ["online"], models: ["claude"] },
        "",
      ),
    ).toBe(true);
    // availability passes, model does not → the AND fails.
    expect(
      rowMatchesAgentFilters(
        row,
        { ...EMPTY_AGENT_FILTERS, availability: ["online"], models: ["gpt-5"] },
        "",
      ),
    ).toBe(false);
  });

  it("treats an empty array as inactive, not as 'match nothing'", () => {
    const row = filterRow({ availability: "offline", model: "gpt-5" });
    expect(
      rowMatchesAgentFilters(
        row,
        { ...EMPTY_AGENT_FILTERS, availability: [], models: [] },
        "",
      ),
    ).toBe(true);
  });

  it("excludes an archived row from every availability selection", () => {
    // The row's derived availability is `archived`, which is in no option.
    const archived = filterRow({ availability: "archived" });
    expect(
      rowMatchesAgentFilters(
        archived,
        { ...EMPTY_AGENT_FILTERS, availability: ["online"] },
        "",
      ),
    ).toBe(false);
    // ...and the archived value is not itself offered, so it cannot be
    // selected either.
    expect(AGENT_FILTER_AVAILABILITY_VALUES).not.toContain("archived");
  });

  it("a row with no presence matches no availability selection (web's null guard)", () => {
    const row = filterRow({ availability: null });
    expect(
      rowMatchesAgentFilters(
        row,
        { ...EMPTY_AGENT_FILTERS, availability: ["online"] },
        "",
      ),
    ).toBe(false);
    // Without a selection the missing presence is irrelevant.
    expect(rowMatchesAgentFilters(row, EMPTY_AGENT_FILTERS, "")).toBe(true);
  });

  it("a row with no owner matches no owner selection (web's null guard)", () => {
    const row = filterRow({ ownerId: null });
    expect(
      rowMatchesAgentFilters(
        row,
        { ...EMPTY_AGENT_FILTERS, owners: ["u-1"] },
        "",
      ),
    ).toBe(false);
    expect(rowMatchesAgentFilters(row, EMPTY_AGENT_FILTERS, "")).toBe(true);
  });

  it("filters by runtime and owner id", () => {
    const row = filterRow({ runtimeId: "rt-9", ownerId: "u-7" });
    expect(
      rowMatchesAgentFilters(
        row,
        { ...EMPTY_AGENT_FILTERS, runtimes: ["rt-9"] },
        "",
      ),
    ).toBe(true);
    expect(
      rowMatchesAgentFilters(
        row,
        { ...EMPTY_AGENT_FILTERS, runtimes: ["rt-other"] },
        "",
      ),
    ).toBe(false);
    expect(
      rowMatchesAgentFilters(
        row,
        { ...EMPTY_AGENT_FILTERS, owners: ["u-7"] },
        "",
      ),
    ).toBe(true);
  });
});

describe("countActiveAgentFilters", () => {
  it("counts dimensions, not selected values", () => {
    expect(countActiveAgentFilters(EMPTY_AGENT_FILTERS)).toBe(0);
    expect(
      countActiveAgentFilters({
        ...EMPTY_AGENT_FILTERS,
        availability: ["online", "offline", "unstable"],
      }),
    ).toBe(1);
    expect(
      countActiveAgentFilters({
        ...EMPTY_AGENT_FILTERS,
        availability: ["online"],
        models: ["claude"],
      }),
    ).toBe(2);
    expect(
      countActiveAgentFilters({
        availability: ["online"],
        runtimes: ["rt-1"],
        owners: ["u-1"],
        models: ["claude"],
      }),
    ).toBe(4);
  });
});

describe("buildAgentFilterOptions", () => {
  const noLabels = {
    runtime: (id: string) => `runtime:${id}`,
    owner: (id: string) => `owner:${id}`,
  };

  it("derives counts from the rows it is given, unfiltered by search", () => {
    // The caller passes SCOPE rows (pre-search, pre-filter) — that is the
    // whole point, so a single dimension cannot erase its siblings. This test
    // pins the counting behaviour; the caller-side wiring is what guarantees
    // the rows are unfiltered.
    const rows = [
      filterRow({ id: "a", availability: "online", runtimeId: "rt-1" }),
      filterRow({ id: "b", availability: "online", runtimeId: "rt-1" }),
      filterRow({ id: "c", availability: "offline", runtimeId: "rt-2" }),
    ];
    const opts = buildAgentFilterOptions(rows, noLabels);
    expect(opts.runtimes).toEqual([
      { value: "rt-1", label: "runtime:rt-1", count: 2 },
      { value: "rt-2", label: "runtime:rt-2", count: 1 },
    ]);
    const byValue = new Map(opts.availability.map((o) => [o.value, o.count]));
    expect(byValue.get("online")).toBe(2);
    expect(byValue.get("offline")).toBe(1);
    expect(byValue.get("unstable")).toBe(0);
  });

  it("offers all three availability values even at zero count", () => {
    const opts = buildAgentFilterOptions([filterRow({ availability: "online" })], noLabels);
    expect(opts.availability.map((o) => o.value)).toEqual([
      "online",
      "unstable",
      "offline",
    ]);
  });

  it("does not offer `archived` as an availability option", () => {
    const opts = buildAgentFilterOptions(
      [filterRow({ availability: "archived" })],
      noLabels,
    );
    expect(opts.availability.map((o) => o.value)).not.toContain("archived");
  });

  it("counts archived rows toward runtime / owner / model (web does)", () => {
    // Web only special-cases availability; an archived row still contributes
    // to the other three dimensions (`agent-list-toolbar.tsx:143-173`).
    const opts = buildAgentFilterOptions(
      [
        filterRow({
          id: "archived",
          availability: "archived",
          runtimeId: "rt-1",
          ownerId: "u-1",
          model: "claude",
        }),
      ],
      noLabels,
    );
    expect(opts.runtimes).toEqual([
      { value: "rt-1", label: "runtime:rt-1", count: 1 },
    ]);
    expect(opts.owners).toEqual([
      { value: "u-1", label: "owner:u-1", count: 1 },
    ]);
    expect(opts.models).toEqual([{ value: "claude", label: "claude", count: 1 }]);
  });

  it("shows the model id verbatim (web does not prettify it)", () => {
    const opts = buildAgentFilterOptions(
      [filterRow({ model: "gpt-5.1-codex" })],
      noLabels,
    );
    expect(opts.models).toEqual([
      { value: "gpt-5.1-codex", label: "gpt-5.1-codex", count: 1 },
    ]);
  });

  it("skips rows missing an owner id or model", () => {
    const opts = buildAgentFilterOptions(
      [filterRow({ ownerId: null, model: "" })],
      noLabels,
    );
    expect(opts.owners).toEqual([]);
    expect(opts.models).toEqual([]);
  });

  it("keeps first-seen row order (web builds these as insertion-ordered Maps)", () => {
    const rows = [
      filterRow({ id: "a", model: "z-model" }),
      filterRow({ id: "b", model: "a-model" }),
    ];
    const opts = buildAgentFilterOptions(rows, noLabels);
    expect(opts.models.map((o) => o.value)).toEqual(["z-model", "a-model"]);
  });
});
