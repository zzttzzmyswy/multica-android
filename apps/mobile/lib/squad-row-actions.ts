/**
 * Which actions a squads-LIST row offers — the pure half of the list-row kebab
 * added in iteration 231 (MYS-2102), mirroring web's `SquadRowActions`
 * (`packages/views/squads/components/squads-page.tsx:320-374`).
 *
 * Before this round the row's only exit was `router.push` to the squad detail
 * page, so archiving a squad meant opening it first. The write already existed
 * on the detail page (`squads/[id].tsx` → `useDeleteSquad`) — what was missing
 * was this entry point.
 *
 * Two web rules are mirrored, and the second one is the round's whole point:
 *
 *   1. **The menu holds only `archive`.** Web's kebab also carries
 *      `open_in_new_tab`, which is not ported — a phone has no tabs and the row
 *      tap already opens the squad, the same reason the other three surfaces
 *      this round omit it. There is no restore: the server has no un-archive
 *      endpoint (`squad.go`'s `DeleteSquad` sets `archived_at` and returns 204),
 *      so web's archive dialog says so outright.
 *   2. **The gate is per-ROW, not per-screen-and-then-assumed.** Web computes
 *      `canManageAnyRow = isWorkspaceAdmin || rows.some(s => s.creator_id ===
 *      currentUser.id)` (`:904`) to reserve the kebab *column*, but the cell
 *      itself renders `SquadRowActions` only when
 *      `isWorkspaceAdmin || squad.creator_id === currentUser.id` (`:1020-1022`).
 *      A list where the admin created some but not all squads gets a kebab on
 *      exactly the ones they own — this deployment has one squad, created by
 *      the workspace owner, so the two rules coincide today and a
 *      screen-level `isAdmin` check would look correct while being wrong the
 *      first time a second member creates a squad. MUL-4223 is the rule being
 *      mirrored (`lib/squad-guards.ts` states the same for detail).
 *
 * `squadManageGuards` already encodes rule 2 for one squad; this module reuses
 * it rather than restating `creator_id === currentUser.id` here, so the list,
 * the detail page and the server's `canManageSquad` stay one rule.
 */
import type { Squad } from "@multica/core/types";
import { squadManageGuards } from "./squad-guards";

export type SquadRowAction = "archive";

/** The slice of a list row the decisions read. */
export type SquadRowActionInput = Pick<Squad, "id" | "name" | "creator_id" | "archived_at">;

export interface SquadRowActionInputs {
  /** Role of the current user's own workspace membership row. */
  currentRole: "owner" | "admin" | "member" | null | undefined;
  /** Current user's User UUID. */
  currentUserId: string | null | undefined;
}

/**
 * The kebab's items, in menu order — `["archive"]` when the viewer may manage
 * this squad, `[]` otherwise (web renders nothing in that cell).
 *
 * An already-archived squad gets no menu either: `ListSquads` filters
 * `archived_at IS NULL` server-side, so an archived row only reaches the list
 * through a stale cache, and `DeleteSquad` rejects a second archive with
 * "squad is already archived" (`squad.go:497`). Offering it there would be an
 * entry that can only fail.
 */
export function squadRowActions(
  row: SquadRowActionInput,
  inputs: SquadRowActionInputs,
): SquadRowAction[] {
  if (row.archived_at) return [];
  const canManage = squadManageGuards({
    currentRole: inputs.currentRole,
    currentUserId: inputs.currentUserId,
    squad: { creator_id: row.creator_id },
  });
  return canManage ? ["archive"] : [];
}
