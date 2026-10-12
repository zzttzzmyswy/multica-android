/**
 * The squads-list row actions (iteration 231, MYS-2102) — the mobile port of
 * web's `SquadRowActions`
 * (`packages/views/squads/components/squads-page.tsx:320-374`, gated at
 * `:1020-1022`).
 *
 * The rule worth pinning is the per-ROW gate. This deployment has one squad,
 * created by the workspace owner, so `isWorkspaceAdmin` and
 * `creator_id === currentUser.id` currently agree on every row — a
 * screen-level `isAdmin` check would pass on-device and be wrong the first time
 * a second member creates a squad (MUL-4223). Every branch below is therefore
 * driven by the creator half specifically.
 */
import { describe, expect, it } from "vitest";
import type { Squad } from "@multica/core/types";
import { squadRowActions } from "./squad-row-actions";

const ME = "u-me";
const SOMEONE_ELSE = "u-someone";

function squad(overrides: Partial<Squad> = {}): Squad {
  return {
    id: "s1",
    workspace_id: "w1",
    name: "专业开发团队",
    description: "",
    instructions: "",
    avatar_url: null,
    leader_id: "a1",
    creator_id: ME,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    archived_at: null,
    archived_by: null,
    ...overrides,
  } as Squad;
}

describe("squadRowActions", () => {
  it("offers archive to a workspace admin on any squad", () => {
    for (const role of ["owner", "admin"] as const) {
      for (const creator_id of [ME, SOMEONE_ELSE]) {
        expect(
          squadRowActions(squad({ creator_id }), { currentRole: role, currentUserId: ME }),
        ).toEqual(["archive"]);
      }
    }
  });

  it("offers archive to a plain member on a squad they created", () => {
    // MUL-4223's creator scope. Web renders `SquadRowActions` for this case
    // (`:1020`) even though the header "+" stays admin-only.
    expect(
      squadRowActions(squad({ creator_id: ME }), {
        currentRole: "member",
        currentUserId: ME,
      }),
    ).toEqual(["archive"]);
  });

  it("offers nothing to a plain member on someone else's squad", () => {
    // The whole point of the round's gate: this row must be bare even though
    // another row on the SAME screen has a kebab. Web's screen-level
    // `canManageAnyRow` reserves the column; the cell is per-row.
    expect(
      squadRowActions(squad({ creator_id: SOMEONE_ELSE }), {
        currentRole: "member",
        currentUserId: ME,
      }),
    ).toEqual([]);
  });

  it("offers nothing when ownership cannot be established", () => {
    // A null current user can never match a creator, and a caller with no
    // creator id must not match a viewer who also has none.
    expect(
      squadRowActions(squad(), { currentRole: "member", currentUserId: null }),
    ).toEqual([]);
    expect(
      squadRowActions(squad({ creator_id: null as unknown as string }), {
        currentRole: "member",
        currentUserId: null,
      }),
    ).toEqual([]);
  });

  it("still honours the creator half while the role is unresolved", () => {
    // Web's `canManageAnyRow` is `isWorkspaceAdmin || (!!currentUser &&
    // creator match)` — the two halves are independent, so an unresolved
    // member list (role null) does not suppress a squad the viewer created.
    // The admin half is what fails closed on an unknown role; this one is
    // decided entirely by ids the auth store already has.
    expect(
      squadRowActions(squad({ creator_id: ME }), {
        currentRole: null,
        currentUserId: ME,
      }),
    ).toEqual(["archive"]);
    // …and with no role AND no ownership there is still nothing to offer.
    expect(
      squadRowActions(squad({ creator_id: SOMEONE_ELSE }), {
        currentRole: null,
        currentUserId: ME,
      }),
    ).toEqual([]);
  });

  it("offers nothing on an already-archived squad", () => {
    // `ListSquads` filters `archived_at IS NULL` server-side, so an archived
    // row only appears through a stale cache — and `DeleteSquad` rejects a
    // second archive with "squad is already archived" (`squad.go:497`). An
    // entry there could only fail.
    expect(
      squadRowActions(squad({ archived_at: "2026-02-01T00:00:00Z" }), {
        currentRole: "owner",
        currentUserId: ME,
      }),
    ).toEqual([]);
  });

  it("has no restore entry, because the server has no un-archive endpoint", () => {
    // `DeleteSquad` sets `archived_at` and returns 204; there is no inverse
    // route and web has no restore item either. Pinned so a later round does
    // not add one against a 404.
    for (const archived_at of [null, "2026-02-01T00:00:00Z"]) {
      const actions = squadRowActions(squad({ archived_at }), {
        currentRole: "owner",
        currentUserId: ME,
      });
      expect(actions).not.toContain("restore");
    }
  });

  it("never offers more than archive — `open_in_new_tab` is not ported", () => {
    // Web's kebab also carries `open_in_new_tab` (`:339-352`); a phone has no
    // tabs and the row tap already opens the squad.
    expect(
      squadRowActions(squad(), { currentRole: "owner", currentUserId: ME }),
    ).toEqual(["archive"]);
  });
});
