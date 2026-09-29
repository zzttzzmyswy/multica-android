/**
 * Agents-list search + sort + scope helpers — mobile port of web's agents
 * page (`packages/views/agents/components/agents-page.tsx`):
 * `matchesAgentSearch` (:167-176), the scope partition (:183-197) and the
 * `rows` comparator (:906-936), with the sort/scope vocabulary from web's
 * agents view store (`packages/core/agents/stores/view-store.ts` :27-63).
 *
 * One deliberate mobile difference, inherited from the list's own design
 * rather than chosen here:
 *
 *   - **`runs` is the 30-day run count** (`/api/agent-run-counts`), the same
 *     number web's RUNS column sorts on — not the live active-task count,
 *     which is a different metric and is what the row's "· N tasks" shows.
 *
 * The archived tier inside `sortAgentRows` is unreachable from the page: each
 * scope is mutually exclusive, so the `archived` scope holds only archived
 * rows and `mine` / `all` hold none. It stays as a guard for callers that
 * pass a mixed row set (the pre-scope page did exactly that).
 */
import type { Agent } from "@multica/core/types";
import type { AgentAvailability } from "@multica/core/agents";
import type { AgentActivity } from "./agent-activity";
import { matchesPinyin } from "./pinyin-match";

export type AgentSortField = "lastActive" | "name" | "runs" | "created";
export type AgentSortDirection = "asc" | "desc";

/**
 * Ownership/lifecycle lens over the agents list — web's `AgentsScope`
 * (`view-store.ts:21`), same three values and same declaration order.
 *
 * The axis is impure on paper (two ownership lenses plus one lifecycle
 * stage), which is web's own design note: `mine` and `all` are the
 * ownership lens over *active* agents, `archived` ignores the ownership lens
 * entirely because showing only *your* archived agents would hide other
 * people's with no UI to explain why.
 */
export type AgentsScope = "mine" | "all" | "archived";

/** Presentation order of the scope pills — web's `AGENT_SCOPES`
 *  (`view-store.ts:23`), which is also the order its toolbar renders. */
export const AGENT_SCOPES: AgentsScope[] = ["mine", "all", "archived"];

/**
 * Web's default scope is `mine` (`view-store.ts:99-101`: "the historical
 * default — most members care about their own agents first"). Mobile keeps
 * that default: the list is reached from a personal popover and its primary
 * job is "what are my agents doing".
 */
export const DEFAULT_AGENTS_SCOPE: AgentsScope = "mine";

/** Per-scope totals from the FULL set — web's `scopeCounts` (`agents-page.tsx`
 *  :848-867`), which counts over every agent and deliberately ignores the
 *  active filters, so the pill counts never collapse as filters apply. An
 *  agent with `archived_at` counts only toward `archived`. */
export interface AgentsScopeCounts {
  mine: number;
  all: number;
  archived: number;
}

/** The lifecycle/ownership fields the scope partition reads. */
export type AgentScopeAgent = Pick<
  Agent,
  "owner_id" | "archived_at" | "status"
>;

/**
 * Whether an agent is archived. `archived_at` is authoritative; `status` is
 * the server-driven lifecycle fallback, compared through `String()` because
 * the field is typed as the legacy union while the server may send a newer
 * value.
 */
export function isArchivedAgent(agent: {
  archived_at?: string | null;
  status?: string;
}): boolean {
  return !!agent.archived_at || String(agent.status) === "archived";
}

/**
 * Scope predicate — the mobile port of web's inline scope filter
 * (`agents-page.tsx:871-877`), clause for clause: `archived` selects exactly
 * the archived rows, and the other two scopes exclude them outright (so an
 * archived agent can never appear under `mine` even when you own it).
 */
export function agentMatchesScope(
  agent: AgentScopeAgent,
  scope: AgentsScope,
  currentUserId: string | null,
): boolean {
  const archived = isArchivedAgent(agent);
  if (scope === "archived") return archived;
  if (archived) return false;
  if (scope === "mine") return !!currentUserId && agent.owner_id === currentUserId;
  return true;
}

/** Count the full set per scope — web's `scopeCounts` (:848-867). */
export function countAgentsByScope(
  agents: readonly AgentScopeAgent[],
  currentUserId: string | null,
): AgentsScopeCounts {
  let mine = 0;
  let all = 0;
  let archived = 0;
  for (const agent of agents) {
    if (isArchivedAgent(agent)) {
      archived++;
      continue;
    }
    all++;
    if (currentUserId && agent.owner_id === currentUserId) mine++;
  }
  return { mine, all, archived };
}

/** Presentation order of the sort menu — most useful first, matching web's
 *  `AGENT_SORT_DEFAULT_DIRECTION` declaration order. */
export const AGENT_SORT_FIELDS: AgentSortField[] = [
  "lastActive",
  "name",
  "runs",
  "created",
];

/** Per-field direction applied when the user switches TO that field —
 *  identical to web (view-store.ts:31-41). */
export const AGENT_SORT_DEFAULT_DIRECTION: Record<
  AgentSortField,
  AgentSortDirection
> = {
  lastActive: "desc",
  name: "asc",
  runs: "desc",
  created: "desc",
};

/** Multi-select filter state — mobile port of web's `AgentListFilters`
 *  (`packages/core/agents/stores/view-store.ts:42-63`), minus the `access`
 *  dimension: mobile's access chips (`ScopeFilterChips` in the agents route)
 *  are already web's `filters.access` equivalent, so re-offering it here would
 *  duplicate the same axis twice on one screen. Empty array per dimension =
 *  inactive, exactly as web. */
export interface AgentListFilters {
  /** `AgentAvailability` values the filter offers: online / unstable / offline.
   *  Typed `string[]` exactly as web does (`view-store.ts:44` declares
   *  `availability: string[]`) — the OPTION list
   *  (`AGENT_FILTER_AVAILABILITY_VALUES`) is what carries the narrow
   *  `AgentAvailability` type, so the offered values stay pinned there while
   *  the selection state stays a plain string list, like web's.
   *  `archived` is deliberately not offered: web's `AVAILABILITY_VALUES`
   *  (`agent-list-toolbar.tsx:77-81`) stops at the three runtime states, so an
   *  archived row matches no availability checkbox (its derived availability
   *  is `archived`, which is in no option list). */
  availability: string[];
  /** Runtime ids. */
  runtimes: string[];
  /** Owner user ids. */
  owners: string[];
  /** Runtime-native model identifiers (e.g. claude / codex / gpt-…). */
  models: string[];
}

export const EMPTY_AGENT_FILTERS: AgentListFilters = {
  availability: [],
  runtimes: [],
  owners: [],
  models: [],
};

/** The availability options the filter offers, in web's declaration order
 *  (`agent-list-toolbar.tsx:77-81`). */
export const AGENT_FILTER_AVAILABILITY_VALUES: AgentAvailability[] = [
  "online",
  "unstable",
  "offline",
];

/** How many dimensions are active — drives the toolbar badge, web's
 *  `countActiveFilterDimensions` (`agent-list-toolbar.tsx:83-97`) over the
 *  four dimensions mobile carries. */
export function countActiveAgentFilters(filters: AgentListFilters): number {
  let count = 0;
  if (filters.availability.length > 0) count++;
  if (filters.runtimes.length > 0) count++;
  if (filters.owners.length > 0) count++;
  if (filters.models.length > 0) count++;
  return count;
}

/** The agent fields the filter and its option lists read. */
export type AgentFilterAgent = Pick<
  Agent,
  "name" | "description" | "runtime_id" | "owner_id" | "model"
>;

/**
 * A row the filter reads. Generic in the agent type so a caller that holds
 * full `Agent` rows keeps them (the page maps straight back to `Agent`), while
 * a unit test can pass the four-field stub. `availability` is the row's
 * already-derived value (`null` when the row has no presence), so the filter
 * and the row's dot cannot disagree about what "online" means.
 */
export interface AgentFilterRow<A extends AgentFilterAgent = AgentFilterAgent> {
  agent: A;
  availability: AgentAvailability | null;
}

/**
 * Row predicate — the mobile port of web's `rowMatchesFilters`
 * (`packages/views/agents/components/agents-page.tsx:184-226`), reproduced
 * clause for clause: search first, then the four dimensions. Across
 * dimensions the clauses are AND (every active dimension must pass); within a
 * dimension the membership test is OR (`includes`); an empty array means the
 * dimension is inactive and the row passes it. The `null` guards on
 * availability and owner are web's own, kept so a row missing either value
 * cannot match a non-empty selection (matching nothing is the honest reading
 * of "you asked for someone and this row has no one").
 */
export function rowMatchesAgentFilters<A extends AgentFilterAgent>(
  row: AgentFilterRow<A>,
  filters: AgentListFilters,
  query: string,
): boolean {
  if (!matchesAgentSearch(row.agent, query.trim().toLowerCase())) return false;
  if (
    filters.availability.length > 0 &&
    (!row.availability || !filters.availability.includes(row.availability))
  ) {
    return false;
  }
  if (
    filters.runtimes.length > 0 &&
    !filters.runtimes.includes(row.agent.runtime_id)
  ) {
    return false;
  }
  if (
    filters.owners.length > 0 &&
    (!row.agent.owner_id || !filters.owners.includes(row.agent.owner_id))
  ) {
    return false;
  }
  if (filters.models.length > 0 && !filters.models.includes(row.agent.model)) {
    return false;
  }
  return true;
}

/** A dimension option with its count, in first-seen row order (web builds its
 *  option lists by iterating `allRows` into a Map, so insertion order is the
 *  row order — `agent-list-toolbar.tsx:143-173`). */
export interface AgentFilterOption {
  value: string;
  label: string;
  count: number;
}

export interface AgentFilterOptions {
  availability: AgentFilterOption[];
  runtimes: AgentFilterOption[];
  owners: AgentFilterOption[];
  models: AgentFilterOption[];
}

/**
 * Build the four dimensions' option lists from the CURRENT SCOPE's UNFILTERED
 * rows. Web is explicit about this (`agent-list-toolbar.tsx:143-145`):
 * options come from the scope's rows before any filter (and before the
 * search) is applied, so toggling one dimension never makes the other
 * dimensions' options vanish. Deriving them from the filtered result instead
 * would make the sheet collapse to the current selection — the classic
 * self-erasing faceted filter bug.
 *
 * `availability` is filtered to the three offered values, so an archived row
 * contributes no availability option (it still counts toward runtime / owner /
 * model, as web does). `labelOf` supplies runtime and owner display names —
 * the caller owns those lookups (runtime list, members list) and both fall
 * back to the raw identifier the way web does.
 */
export function buildAgentFilterOptions<A extends AgentFilterAgent>(
  rows: readonly AgentFilterRow<A>[],
  labelOf: {
    runtime: (runtimeId: string) => string;
    owner: (ownerId: string) => string;
  },
): AgentFilterOptions {
  const availabilityCounts = new Map<string, number>();
  const runtimeCounts = new Map<string, number>();
  const ownerCounts = new Map<string, number>();
  const modelCounts = new Map<string, number>();

  const bump = (map: Map<string, number>, key: string) => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  for (const row of rows) {
    if (row.availability) bump(availabilityCounts, row.availability);
    const runtimeId = row.agent.runtime_id;
    if (runtimeId) bump(runtimeCounts, runtimeId);
    const ownerId = row.agent.owner_id;
    if (ownerId) bump(ownerCounts, ownerId);
    const model = row.agent.model;
    if (model) bump(modelCounts, model);
  }

  const options = (
    counts: Map<string, number>,
    label: (key: string) => string,
  ): AgentFilterOption[] =>
    [...counts.entries()].map(([value, count]) => ({
      value,
      label: label(value),
      count,
    }));

  return {
    availability: AGENT_FILTER_AVAILABILITY_VALUES.map((value) => ({
      value,
      label: value,
      // Web renders every availability value regardless of count (its
      // `AVAILABILITY_VALUES.map` has no count guard), so a zero-count state
      // is still a visible, checkable row that yields an empty list.
      count: availabilityCounts.get(value) ?? 0,
    })),
    runtimes: options(runtimeCounts, labelOf.runtime),
    owners: options(ownerCounts, labelOf.owner),
    models: options(modelCounts, (m) => m),
  };
}

/**
 * Search predicate: name or description, case-insensitive, with pinyin
 * matching on both (web agents-page.tsx:167-176 routes both fields through
 * `matchesPinyin`). An empty query matches everything.
 */
export function matchesAgentSearch(
  agent: Pick<Agent, "name" | "description">,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (agent.name.toLowerCase().includes(q) || matchesPinyin(agent.name, q)) {
    return true;
  }
  const description = agent.description;
  if (!description) return false;
  return (
    description.toLowerCase().includes(q) || matchesPinyin(description, q)
  );
}

/**
 * Most recent activity bucket with runs, as "days ago" (0 = today). Day
 * granularity on purpose — derived from the same 30-day buckets the detail
 * page charts, so it costs no extra request beyond the ones the list already
 * makes for the RUNS sort. `null` = never active in the window.
 */
export function lastActiveDaysAgo(activity: AgentActivity | null): number | null {
  if (!activity) return null;
  for (let i = activity.buckets.length - 1; i >= 0; i--) {
    const bucket = activity.buckets[i];
    if (bucket && bucket.total > 0) return activity.buckets.length - 1 - i;
  }
  return null;
}

/** The slice of an agent row the sort reads — the page keeps the rest
 *  (presence, runtime, ownership) alongside it. */
export interface AgentSortInput {
  agent: Pick<Agent, "name" | "created_at">;
  archived: boolean;
  /** 30-day run count; 0 when the agent has none (web substitutes 0 too). */
  runCount: number;
  /** `lastActiveDaysAgo` of this agent's activity. */
  lastActiveDays: number | null;
}

/**
 * Sort rows by the chosen field + direction, mirroring web's comparators
 * (`agents-page.tsx:906-936`) including their tiebreaks. The archived tier is
 * a guard for mixed row sets only — the page partitions by scope first, so a
 * set reaching here from it is already single-tier.
 *
 * `lastActive` sorts never-active rows as the LEAST recently active: last on
 * `desc` (the default, most-recent-first) and first on `asc`. That is what
 * web's comparator actually does (`av = lastActiveDays ?? Infinity`, then the
 * days delta inverted for asc — agents-page.tsx:924-931); the adjacent web
 * comment claims "last in both directions", which its own code contradicts.
 * The code wins here: "infinitely long ago" is the honest reading of a
 * missing value on a recency axis, and mobile's list, unlike web's table, has
 * no other column to disambiguate it.
 */
export function sortAgentRows<T extends AgentSortInput>(
  rows: readonly T[],
  field: AgentSortField,
  direction: AgentSortDirection,
): T[] {
  const dir = direction === "asc" ? 1 : -1;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    // Permanent tier: an archived agent never outranks an active one, whatever
    // the field says.
    if (a.archived !== b.archived) return a.archived ? 1 : -1;

    switch (field) {
      case "name":
        return a.agent.name.localeCompare(b.agent.name) * dir;
      case "created":
        return (
          (Date.parse(a.agent.created_at) - Date.parse(b.agent.created_at)) *
          dir
        );
      case "runs":
        // Web tiebreaks on name ASC regardless of direction.
        return (
          (a.runCount - b.runCount) * dir ||
          a.agent.name.localeCompare(b.agent.name)
        );
      case "lastActive":
      default: {
        // Smaller daysAgo = more recent. `desc` (the default) means most
        // recently active first; a never-active agent reads as "infinitely
        // long ago", so it lands last on desc and first on asc — web's exact
        // comparator. Run count, then name, break ties — also web's order.
        const av = a.lastActiveDays ?? Number.POSITIVE_INFINITY;
        const bv = b.lastActiveDays ?? Number.POSITIVE_INFINITY;
        const byDays = direction === "desc" ? av - bv : bv - av;
        return (
          byDays ||
          b.runCount - a.runCount ||
          a.agent.name.localeCompare(b.agent.name)
        );
      }
    }
  });
  return sorted;
}
