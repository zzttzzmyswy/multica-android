/**
 * Scope predicate + pill counts for the squads list. Web parity target:
 * `packages/views/squads/components/squads-page.tsx:821-838`, where "mine"
 * is `creator_id === currentUser.id` and the counts are computed over the
 * unfiltered list so the badges don't move when the user switches scope.
 */
import { describe, expect, it } from "vitest";
import type { Squad } from "@multica/core/types";
import {
  SQUAD_SCOPES,
  SQUAD_SCOPE_LABEL_KEYS,
  filterSquadsByScope,
  squadMatchesScope,
  squadScopeCounts,
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
