/**
 * Agents-list search + sort helpers — mobile port of web's agents page
 * (`packages/views/agents/components/agents-page.tsx`): `matchesAgentSearch`
 * (:167-176) and the `rows` comparator (:906-936), with the sort vocabulary
 * from web's agents view store (`packages/core/agents/stores/view-store.ts`
 * :27-41).
 *
 * Two deliberate mobile differences, both inherited from the list's own
 * design rather than chosen here:
 *
 *   - **Archived rows always sort after active ones.** Web never mixes the
 *     two — its `mine` / `all` / `archived` scopes are mutually exclusive.
 *     Mobile keeps one list per scope filter and dims archived rows in place,
 *     so "active first" is a permanent tier the field/direction cannot
 *     reorder (same guarantee the pre-1020 page hard-coded).
 *   - **`runs` is the 30-day run count** (`/api/agent-run-counts`), the same
 *     number web's RUNS column sorts on — not the live active-task count,
 *     which is a different metric and is what the row's "· N tasks" shows.
 */
import type { Agent } from "@multica/core/types";
import type { AgentActivity } from "./agent-activity";
import { matchesPinyin } from "./pinyin-match";

export type AgentSortField = "lastActive" | "name" | "runs" | "created";
export type AgentSortDirection = "asc" | "desc";

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
 * (`agents-page.tsx:906-936`) including their tiebreaks, and keeping
 * archived rows in a trailing tier that no field or direction can reorder.
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
