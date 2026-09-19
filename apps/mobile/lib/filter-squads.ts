/**
 * Squads list scope predicate + counts. Mirrors web
 * `packages/views/squads/components/squads-page.tsx:821-838` — scope is the
 * ownership lens, keyed on `creator_id` (NOT the leader agent): a squad's
 * creator holds no management rights, so "mine" means "I made this", not
 * "I lead this".
 *
 * There is deliberately no "archived" scope: the list endpoint hard-filters
 * archived squads in web, and the mobile list keeps archived rows dimmed and
 * sorted last instead — a separate axis from scope, so an archived squad the
 * user created still counts toward "mine".
 */
import type { Squad } from "@multica/core/types";

export type SquadsScope = "mine" | "all";

export const SQUAD_SCOPES: SquadsScope[] = ["mine", "all"];

/** Label keys live in the mobile locale bundle under `squads.scope.*`. */
export const SQUAD_SCOPE_LABEL_KEYS: Record<SquadsScope, string> = {
  mine: "squads.scope.mine",
  all: "squads.scope.all",
};

/**
 * Membership for one scope. `currentUserId === null` (auth not resolved, or
 * a server that omits the user) matches nothing under "mine" — the same
 * fail-closed read web takes with `!!currentUser && …`, so a slow auth
 * resolve cannot briefly show every squad as the user's own.
 */
export function squadMatchesScope(
  squad: Squad,
  scope: SquadsScope,
  currentUserId: string | null,
): boolean {
  if (scope === "all") return true;
  return !!currentUserId && squad.creator_id === currentUserId;
}

/** Counts for the scope pills — computed over the FULL list so the badge
 *  never changes as the user switches scope. */
export function squadScopeCounts(
  squads: readonly Squad[],
  currentUserId: string | null,
): Record<SquadsScope, number> {
  let mine = 0;
  for (const s of squads) {
    if (currentUserId && s.creator_id === currentUserId) mine++;
  }
  return { mine, all: squads.length };
}

export function filterSquadsByScope(
  squads: readonly Squad[],
  scope: SquadsScope,
  currentUserId: string | null,
): Squad[] {
  return squads.filter((s) => squadMatchesScope(s, scope, currentUserId));
}
