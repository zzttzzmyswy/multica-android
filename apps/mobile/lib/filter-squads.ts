/**
 * Squads-list scope, sort, filter and option-list helpers. Mirrors web
 * `packages/views/squads/components/squads-page.tsx` — scope is the ownership
 * lens keyed on `creator_id` (NOT the leader agent): a squad's creator holds
 * no management rights, so "mine" means "I made this", not "I lead this".
 *
 * The toolbar half (iteration 178) ports web's `scopeRows` :825-838,
 * `leaderOptions` :840-853, `creatorOptions` :855-868 and the `rows`
 * comparator :870-898, with the vocabulary from web's squads view store
 * (`packages/core/squads/stores/view-store.ts`).
 *
 * There is deliberately no "archived" scope: the list endpoint hard-filters
 * archived squads in web, and the mobile list keeps archived rows dimmed and
 * sorted last instead — a separate axis from scope, so an archived squad the
 * user created still counts toward "mine".
 *
 * Three deliberate mobile differences, each inherited from the list's own
 * design rather than chosen here:
 *
 *   - **Archived squads are a permanent trailing tier.** Web never has to
 *     interleave them (its endpoint filters them out), so the field and
 *     direction may not reorder across that boundary — the same guarantee
 *     `lib/filter-agents.ts` documents for "active first".
 *   - **No column visibility.** Web's `SQUAD_DEFAULT_HIDDEN_COLUMNS` hides a
 *     table column; a mobile row is a card (name / leader / member count) with
 *     no columns to hide, so there is no equivalent state to persist.
 *   - **Scope is not persisted by the view store.** Web persists it; mobile
 *     keeps it session-local, so only sort + filters reach the file.
 *
 * The comparators are copied exactly, including web's asymmetry: `members`
 * tie-breaks on name ASCENDING regardless of the chosen direction.
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

export type SquadSortField = "name" | "members" | "created";
export type SquadSortDirection = "asc" | "desc";

/** Presentation order of the sort menu, matching web's `SORT_FIELDS`. */
export const SQUAD_SORT_FIELDS: SquadSortField[] = ["name", "members", "created"];

/** Per-field direction applied when the user switches TO that field —
 *  identical to web (`SQUAD_SORT_DEFAULT_DIRECTION`). */
export const SQUAD_SORT_DEFAULT_DIRECTION: Record<
  SquadSortField,
  SquadSortDirection
> = {
  name: "asc",
  members: "desc",
  created: "desc",
};

/** Multi-select filter state. An empty array per dimension = inactive. */
export interface SquadListFilters {
  /** Leader agent ids. */
  leaders: string[];
  /** Creator member user ids. */
  creators: string[];
}

export const EMPTY_SQUAD_FILTERS: SquadListFilters = {
  leaders: [],
  creators: [],
};

export type SquadFilterDimension = keyof SquadListFilters;

/** One filter-sheet option: an actor id, its display name, and how many rows
 *  of the *unfiltered* scope carry it. */
export interface SquadActorOption {
  id: string;
  name: string;
  count: number;
}

export function isSquadArchived(squad: Squad): boolean {
  return !!squad.archived_at;
}

/** The member count the list renders and the `members` sort compares — web's
 *  `member_count ?? member_preview.length` (:886-887), with the same 0 floor. */
export function squadMemberCount(squad: Squad): number {
  return squad.member_count ?? squad.member_preview?.length ?? 0;
}

/**
 * Leader options over the scope rows, with counts. Names fall back to the
 * first 8 chars of the id — web's `agentsById.get(id)?.name ?? id.slice(0, 8)`
 * — so an option never renders blank when the agent list has not loaded.
 */
export function squadLeaderOptions(
  scopeRows: readonly Squad[],
  nameOf: (id: string) => string | undefined,
): SquadActorOption[] {
  return buildActorOptions(scopeRows.map((s) => s.leader_id), nameOf);
}

/** Creator options over the scope rows, with counts. */
export function squadCreatorOptions(
  scopeRows: readonly Squad[],
  nameOf: (id: string) => string | undefined,
): SquadActorOption[] {
  return buildActorOptions(scopeRows.map((s) => s.creator_id), nameOf);
}

function buildActorOptions(
  ids: readonly string[],
  nameOf: (id: string) => string | undefined,
): SquadActorOption[] {
  const byId = new Map<string, SquadActorOption>();
  for (const id of ids) {
    const existing = byId.get(id);
    if (existing) existing.count += 1;
    else byId.set(id, { id, name: nameOf(id) ?? id.slice(0, 8), count: 1 });
  }
  return [...byId.values()];
}

/** One row matches the active filters. Empty array per dimension = inactive;
 *  the two dimensions AND together, values within a dimension OR (web :870-882). */
export function squadMatchesFilters(
  squad: Squad,
  filters: SquadListFilters,
): boolean {
  if (filters.leaders.length > 0 && !filters.leaders.includes(squad.leader_id)) {
    return false;
  }
  if (
    filters.creators.length > 0 &&
    !filters.creators.includes(squad.creator_id)
  ) {
    return false;
  }
  return true;
}

export function filterSquadsByFilters(
  squads: readonly Squad[],
  filters: SquadListFilters,
): Squad[] {
  if (countActiveSquadFilterDimensions(filters) === 0) return [...squads];
  return squads.filter((s) => squadMatchesFilters(s, filters));
}

/**
 * Sort rows by the chosen field + direction, mirroring web's comparators
 * (:883-898) including the `members` name tiebreak, while keeping archived
 * rows in a trailing tier no field or direction can reorder.
 *
 * Non-mutating: the caller's array (often memoized) is never reordered.
 */
export function sortSquads(
  squads: readonly Squad[],
  field: SquadSortField,
  direction: SquadSortDirection,
): Squad[] {
  const dir = direction === "asc" ? 1 : -1;
  const sorted = [...squads];
  sorted.sort((a, b) => {
    // Permanent tier: an archived squad never outranks an active one.
    const aArchived = isSquadArchived(a);
    const bArchived = isSquadArchived(b);
    if (aArchived !== bArchived) return aArchived ? 1 : -1;

    if (field === "members") {
      return (
        (squadMemberCount(a) - squadMemberCount(b)) * dir ||
        a.name.localeCompare(b.name)
      );
    }
    if (field === "created") {
      return (Date.parse(a.created_at) - Date.parse(b.created_at)) * dir;
    }
    return a.name.localeCompare(b.name) * dir;
  });
  return sorted;
}

/** How many dimensions are narrowing the list — the filter chip's badge
 *  (web's `activeFilterCount`, :479-482). */
export function countActiveSquadFilterDimensions(
  filters: SquadListFilters,
): number {
  let count = 0;
  if (filters.leaders.length > 0) count++;
  if (filters.creators.length > 0) count++;
  return count;
}

/**
 * Flat key for one filter option, as the multi-select sheet's row identity.
 * The dimension prefix keeps agent and member ids from colliding and lets
 * `parseSquadFilterKey` hand `toggleSquadFilter` its arguments back.
 */
export function squadFilterKey(
  dimension: SquadFilterDimension,
  value: string,
): string {
  return `${dimension}:${value}`;
}

export function parseSquadFilterKey(
  key: string,
): { dimension: SquadFilterDimension; value: string } | null {
  const separator = key.indexOf(":");
  if (separator <= 0) return null;
  const dimension = key.slice(0, separator);
  const value = key.slice(separator + 1);
  if (dimension !== "leaders" && dimension !== "creators") return null;
  if (!value) return null;
  return { dimension, value };
}

/** Toggle one value in one dimension, returning a new filter object. */
export function toggleSquadFilter(
  filters: SquadListFilters,
  dimension: SquadFilterDimension,
  value: string,
): SquadListFilters {
  const list = filters[dimension];
  const next = list.includes(value)
    ? list.filter((entry) => entry !== value)
    : [...list, value];
  return { ...filters, [dimension]: next };
}
