/**
 * Scope predicate + pill counts for the squads list. Web parity target:
 * `packages/views/squads/components/squads-page.tsx:821-838`, where "mine"
 * is `creator_id === currentUser.id` and the counts are computed over the
 * unfiltered list so the badges don't move when the user switches scope.
 *
 * Iteration 178 adds the toolbar half — sort comparators, filter predicate,
 * option lists with counts — with web's `:840-898` as the parity target.
 */
import { describe, expect, it } from "vitest";
import type { Squad } from "@multica/core/types";
import {
  EMPTY_SQUAD_FILTERS,
  SQUAD_SCOPES,
  SQUAD_SCOPE_LABEL_KEYS,
  SQUAD_SORT_DEFAULT_DIRECTION,
  SQUAD_SORT_FIELDS,
  countActiveSquadFilterDimensions,
  filterSquadsByFilters,
  filterSquadsByScope,
  isSquadArchived,
  parseSquadFilterKey,
  squadCreatorOptions,
  squadFilterKey,
  squadLeaderOptions,
  squadMatchesFilters,
  squadMatchesScope,
  squadMemberCount,
  squadScopeCounts,
  sortSquads,
  toggleSquadFilter,
} from "./filter-squads";

function squad(id: string, creatorId: string, archived = false): Squad {
  return {
    id,
    creator_id: creatorId,
    archived_at: archived ? "2026-01-01T00:00:00Z" : null,
  } as unknown as Squad;
}

const MINE_A = squad("a", "user-1");
const MINE_ARCHIVED = squad("b", "user-1", true);
const THEIRS = squad("c", "user-2");

describe("squadMatchesScope", () => {
  it("keeps everything under 'all'", () => {
    for (const s of [MINE_A, MINE_ARCHIVED, THEIRS]) {
      expect(squadMatchesScope(s, "all", "user-1")).toBe(true);
    }
  });

  it("keys 'mine' on creator_id, not the leader", () => {
    // The leader agent is a different entity entirely; scoping on it would
    // show squads somebody else created.
    const led = { id: "d", creator_id: "user-2", leader_id: "user-1" } as unknown as Squad;
    expect(squadMatchesScope(led, "mine", "user-1")).toBe(false);
  });

  it("counts an archived squad the user created as theirs", () => {
    // Archived is a display axis in mobile (dimmed + sorted last), not a
    // scope axis — web's list endpoint hard-filters archived rows, mobile's
    // keeps them, so the predicate must not silently drop them here.
    expect(squadMatchesScope(MINE_ARCHIVED, "mine", "user-1")).toBe(true);
  });

  it("fails closed when the current user is unresolved", () => {
    expect(squadMatchesScope(MINE_A, "mine", null)).toBe(false);
    expect(squadMatchesScope(MINE_A, "all", null)).toBe(true);
  });
});

describe("squadScopeCounts", () => {
  it("counts both scopes over the full list", () => {
    expect(squadScopeCounts([MINE_A, MINE_ARCHIVED, THEIRS], "user-1")).toEqual({
      mine: 2,
      all: 3,
    });
  });

  it("reports mine = 0 rather than all when auth is unresolved", () => {
    expect(squadScopeCounts([MINE_A, THEIRS], null)).toEqual({ mine: 0, all: 2 });
  });

  it("ignores the active scope — badges must not move on switch", () => {
    const list = [MINE_A, THEIRS];
    expect(squadScopeCounts(list, "user-1")).toEqual(squadScopeCounts(list, "user-1"));
  });
});

describe("filterSquadsByScope", () => {
  it("returns only the user's own squads under 'mine'", () => {
    expect(
      filterSquadsByScope([MINE_A, THEIRS, MINE_ARCHIVED], "mine", "user-1").map(
        (s) => s.id,
      ),
    ).toEqual(["a", "b"]);
  });

  it("returns the whole list under 'all'", () => {
    expect(
      filterSquadsByScope([MINE_A, THEIRS], "all", "user-1").map((s) => s.id),
    ).toEqual(["a", "c"]);
  });

  it("never mutates the input", () => {
    const input = [MINE_A, THEIRS];
    filterSquadsByScope(input, "mine", "user-1");
    expect(input).toEqual([MINE_A, THEIRS]);
  });
});

describe("scope constants", () => {
  it("offers exactly mine then all, matching web's SQUAD_SCOPES", () => {
    expect(SQUAD_SCOPES).toEqual(["mine", "all"]);
  });

  it("has a label key for every scope", () => {
    for (const s of SQUAD_SCOPES) {
      expect(SQUAD_SCOPE_LABEL_KEYS[s]).toBe(`squads.scope.${s}`);
    }
  });
});

// ── iteration 178: toolbar helpers ────────────────────────────────────────

/** A row with every field the sort/filter helpers read. */
function row(
  id: string,
  overrides: Partial<{
    name: string;
    leader: string;
    creator: string;
    created: string;
    members: number | undefined;
    preview: number | undefined;
    archived: boolean;
  }> = {},
): Squad {
  const { members, preview, leader, creator, created, name, archived } = overrides;
  return {
    id,
    name: name ?? id,
    leader_id: leader ?? "agent-1",
    creator_id: creator ?? "user-1",
    created_at: created ?? "2026-01-01T00:00:00Z",
    archived_at: archived ? "2026-02-01T00:00:00Z" : null,
    member_count: members,
    member_preview:
      preview === undefined
        ? undefined
        : (Array.from({ length: preview }) as Squad["member_preview"]),
  } as unknown as Squad;
}

describe("squadMemberCount", () => {
  it("prefers member_count over the preview length", () => {
    expect(squadMemberCount(row("a", { members: 5, preview: 2 }))).toBe(5);
  });

  it("falls back to the preview length when member_count is absent", () => {
    expect(squadMemberCount(row("a", { preview: 3 }))).toBe(3);
  });

  it("floors at 0 when neither field is present", () => {
    // Web's `?? 0`; a squad with no members must not read as NaN, which would
    // poison every comparison in the members comparator.
    expect(squadMemberCount(row("a"))).toBe(0);
  });
});

describe("sortSquads", () => {
  it("sorts by name in both directions", () => {
    const list = [row("b", { name: "beta" }), row("a", { name: "Alpha" })];
    expect(sortSquads(list, "name", "asc").map((s) => s.name)).toEqual([
      "Alpha",
      "beta",
    ]);
    expect(sortSquads(list, "name", "desc").map((s) => s.name)).toEqual([
      "beta",
      "Alpha",
    ]);
  });

  it("sorts by members using member_count, then the preview length", () => {
    const list = [
      row("a", { name: "a", members: 3 }),
      row("b", { name: "b", preview: 9 }),
      row("c", { name: "c", members: 1 }),
    ];
    expect(sortSquads(list, "members", "desc").map((s) => s.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(sortSquads(list, "members", "asc").map((s) => s.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("breaks a members tie on name ASCENDING in BOTH directions", () => {
    // Web's asymmetry (:888-889): the tiebreak is not multiplied by `dir`.
    const list = [
      row("z", { name: "zeta", members: 2 }),
      row("a", { name: "alpha", members: 2 }),
    ];
    expect(sortSquads(list, "members", "desc").map((s) => s.name)).toEqual([
      "alpha",
      "zeta",
    ]);
    expect(sortSquads(list, "members", "asc").map((s) => s.name)).toEqual([
      "alpha",
      "zeta",
    ]);
  });

  it("sorts by created_at via Date.parse in both directions", () => {
    const list = [
      row("a", { created: "2026-03-01T00:00:00Z" }),
      row("b", { created: "2026-01-01T00:00:00Z" }),
      row("c", { created: "2026-02-01T00:00:00Z" }),
    ];
    expect(sortSquads(list, "created", "asc").map((s) => s.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(sortSquads(list, "created", "desc").map((s) => s.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("keeps archived squads in a trailing tier no direction can reorder", () => {
    // Mobile-only guarantee: web's endpoint filters archived rows out, so its
    // comparator never has to interleave them. Here `archived` is a display
    // axis, so a field sort must not float an archived row to the top.
    const list = [
      row("archived", { name: "aaa", archived: true, created: "2026-12-01T00:00:00Z" }),
      row("active", { name: "zzz" }),
    ];
    for (const field of SQUAD_SORT_FIELDS) {
      for (const direction of ["asc", "desc"] as const) {
        expect(sortSquads(list, field, direction).map((s) => s.id)).toEqual([
          "active",
          "archived",
        ]);
      }
    }
  });

  it("sorts within the archived tier by the same field", () => {
    const list = [
      row("a2", { name: "b-arch", archived: true }),
      row("a1", { name: "a-arch", archived: true }),
      row("live", { name: "m" }),
    ];
    expect(sortSquads(list, "name", "asc").map((s) => s.id)).toEqual([
      "live",
      "a1",
      "a2",
    ]);
  });

  it("never mutates the input", () => {
    const input = [row("b", { name: "b" }), row("a", { name: "a" })];
    const snapshot = input.map((s) => s.id);
    sortSquads(input, "name", "asc");
    expect(input.map((s) => s.id)).toEqual(snapshot);
  });

  it("offers web's three fields with web's default directions", () => {
    expect(SQUAD_SORT_FIELDS).toEqual(["name", "members", "created"]);
    expect(SQUAD_SORT_DEFAULT_DIRECTION).toEqual({
      name: "asc",
      members: "desc",
      created: "desc",
    });
  });
});

describe("squadMatchesFilters", () => {
  const s = row("a", { leader: "agent-1", creator: "user-1" });

  it("treats an empty dimension as inactive", () => {
    expect(squadMatchesFilters(s, EMPTY_SQUAD_FILTERS)).toBe(true);
  });

  it("ORs values inside one dimension", () => {
    expect(
      squadMatchesFilters(s, { leaders: ["agent-2", "agent-1"], creators: [] }),
    ).toBe(true);
    expect(
      squadMatchesFilters(s, { leaders: ["agent-2", "agent-3"], creators: [] }),
    ).toBe(false);
  });

  it("ANDs across dimensions", () => {
    // A leader match does not excuse a creator mismatch.
    expect(
      squadMatchesFilters(s, { leaders: ["agent-1"], creators: ["user-9"] }),
    ).toBe(false);
  });

  it("filters on the creator, not the leader", () => {
    expect(
      squadMatchesFilters(s, { leaders: [], creators: ["user-1"] }),
    ).toBe(true);
  });
});

describe("filterSquadsByFilters", () => {
  it("returns a copy of the list when nothing is active", () => {
    const list = [MINE_A, THEIRS];
    const out = filterSquadsByFilters(list, EMPTY_SQUAD_FILTERS);
    expect(out).toEqual(list);
    expect(out).not.toBe(list);
  });

  it("narrows to the selected leaders", () => {
    const list = [
      row("a", { leader: "agent-1" }),
      row("b", { leader: "agent-2" }),
    ];
    expect(
      filterSquadsByFilters(list, { leaders: ["agent-2"], creators: [] }).map(
        (s) => s.id,
      ),
    ).toEqual(["b"]);
  });
});

describe("countActiveSquadFilterDimensions", () => {
  it("counts dimensions, not selected values", () => {
    // Web's `activeFilterCount` (:479-482) is a dimension count — three
    // leaders selected is still "1 filter".
    expect(countActiveSquadFilterDimensions(EMPTY_SQUAD_FILTERS)).toBe(0);
    expect(
      countActiveSquadFilterDimensions({
        leaders: ["a", "b", "c"],
        creators: [],
      }),
    ).toBe(1);
    expect(
      countActiveSquadFilterDimensions({ leaders: ["a"], creators: ["u"] }),
    ).toBe(2);
  });
});

describe("filter option lists", () => {
  const scopeRows = [
    row("a", { leader: "agent-1", creator: "user-1" }),
    row("b", { leader: "agent-1", creator: "user-2" }),
    row("c", { leader: "agent-2", creator: "user-2" }),
  ];
  const names: Record<string, string> = {
    "agent-1": "Scout",
    "agent-2": "Ranger",
    "user-1": "Ada",
    "user-2": "Bo",
  };
  const nameOf = (id: string) => names[id];

  it("counts each leader over the unfiltered scope rows", () => {
    expect(squadLeaderOptions(scopeRows, nameOf)).toEqual([
      { id: "agent-1", name: "Scout", count: 2 },
      { id: "agent-2", name: "Ranger", count: 1 },
    ]);
  });

  it("counts each creator over the unfiltered scope rows", () => {
    expect(squadCreatorOptions(scopeRows, nameOf)).toEqual([
      { id: "user-1", name: "Ada", count: 1 },
      { id: "user-2", name: "Bo", count: 2 },
    ]);
  });

  it("falls back to the first 8 chars of the id when the name is unknown", () => {
    // Web's `?? id.slice(0, 8)` — an option must never render blank while the
    // agent/member lists are still loading.
    const options = squadLeaderOptions([row("a", { leader: "0123456789abcdef" })], () => undefined);
    expect(options).toEqual([{ id: "0123456789abcdef", name: "01234567", count: 1 }]);
  });

  it("preserves first-seen order rather than sorting", () => {
    // Web builds these from a Map in row order; the sheet shows that order.
    const options = squadLeaderOptions(
      [row("a", { leader: "z" }), row("b", { leader: "a" })],
      (id) => id,
    );
    expect(options.map((o) => o.id)).toEqual(["z", "a"]);
  });

  it("returns nothing for an empty scope", () => {
    expect(squadLeaderOptions([], nameOf)).toEqual([]);
    expect(squadCreatorOptions([], nameOf)).toEqual([]);
  });
});

describe("filter key codec", () => {
  it("round-trips a dimension and value", () => {
    const key = squadFilterKey("leaders", "agent-1");
    expect(key).toBe("leaders:agent-1");
    expect(parseSquadFilterKey(key)).toEqual({
      dimension: "leaders",
      value: "agent-1",
    });
  });

  it("keeps a value containing a colon intact", () => {
    // Ids are opaque; only the FIRST separator splits the key.
    expect(parseSquadFilterKey("creators:user:1")).toEqual({
      dimension: "creators",
      value: "user:1",
    });
  });

  it("rejects unknown dimensions and empty values", () => {
    expect(parseSquadFilterKey("origins:github")).toBeNull();
    expect(parseSquadFilterKey("leaders:")).toBeNull();
    expect(parseSquadFilterKey("nocolon")).toBeNull();
    expect(parseSquadFilterKey(":value")).toBeNull();
  });
});

describe("toggleSquadFilter", () => {
  it("adds then removes a value in one dimension", () => {
    const once = toggleSquadFilter(EMPTY_SQUAD_FILTERS, "leaders", "agent-1");
    expect(once.leaders).toEqual(["agent-1"]);
    expect(toggleSquadFilter(once, "leaders", "agent-1").leaders).toEqual([]);
  });

  it("leaves the other dimension untouched", () => {
    const base = { leaders: ["agent-1"], creators: ["user-1"] };
    expect(toggleSquadFilter(base, "leaders", "agent-2")).toEqual({
      leaders: ["agent-1", "agent-2"],
      creators: ["user-1"],
    });
  });

  it("does not mutate the input filters", () => {
    const base = { leaders: [] as string[], creators: [] as string[] };
    toggleSquadFilter(base, "leaders", "agent-1");
    expect(base.leaders).toEqual([]);
  });
});

describe("isSquadArchived", () => {
  it("reads archived_at, not a status field", () => {
    expect(isSquadArchived(row("a"))).toBe(false);
    expect(isSquadArchived(row("b", { archived: true }))).toBe(true);
  });
});
