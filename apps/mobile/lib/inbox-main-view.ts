/**
 * Pure view-model for the MAIN inbox's filter layer.
 *
 * The archived sub-view and the main list render the same sheet with the same
 * four dimensions, but they get their counts from opposite places, and that
 * difference is forced rather than stylistic:
 *
 *   - **The archive counts on the server.** Its read path is a cursor page, so
 *     a count computed on the client would describe the pages fetched so far —
 *     "9 done" about an archive holding 816. `archivedInboxFacetsOptions`
 *     exists for exactly that reason.
 *   - **The main list counts here.** `/api/inbox` returns the whole unarchived
 *     inbox in one response (measured against the live server: 3208 rows,
 *     deduplicating to 339 groups), and web's main view filters that response
 *     on the client. There is nothing left over to be wrong about: the same
 *     rows the list draws are the rows the counts are computed over.
 *
 * Web's `InboxFilterMenu` picks between the two with `archived ? facets : local*`
 * (`packages/views/inbox/components/inbox-filter-menu.tsx:173-176`). This module
 * is the mobile half of that branch, kept as pure functions because the screen
 * cannot run in the mobile vitest lane (Node only — see `vitest.config.ts`).
 *
 * ## Faceted, not independent
 *
 * Every count answers "how many rows would selecting this reveal", so it
 * respects the other active dimensions and ignores its own. Computing them over
 * the unfiltered list instead would print a number that never changes as the
 * user narrows, and the row beside it would then disagree with the list it
 * produces. This is upstream's rule and the archived view gets it for free
 * because the server applies it to the facet request.
 */
import type { InboxItem } from "@multica/core/types";
import {
  filterInboxItems,
  inboxActorKey,
  type InboxFilters,
} from "@/lib/inbox-filters";

/** The shape the filter sheet reads: the same one the facets endpoint returns. */
export interface InboxFacetCounts {
  statuses: Record<string, number>;
  priorities: Record<string, number>;
  actors: Record<string, number>;
  unreadCount: number;
}

/**
 * How many rows carry each value of one dimension. Rows whose value is null
 * (an issue-less notification has no status, no priority and possibly no
 * usable actor) are absent from every map, which is what makes them
 * unselectable — the same rule `filterInboxItems` applies to them, so a count
 * never offers a row the predicate would then exclude.
 */
function countsOf<T extends string>(
  items: readonly InboxItem[],
  value: (item: InboxItem) => T | null,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = value(item);
    if (key == null) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * The four dimensions counted over the deduplicated main list, each respecting
 * the other three.
 *
 * `unreadOnly` is counted by clearing its own flag and then counting the rows
 * that are still unread, rather than by re-running `filterInboxItems` with the
 * flag set: with the flag set the predicate would apply it, and the answer
 * would be the visible total (0 or N) instead of the number of rows selecting
 * it would reveal. Web does the same thing, in the same two steps
 * (`inbox-filter-menu.tsx:154-160`).
 *
 * **The actor map is a universe, not a filtered count.** It carries a key for
 * every actor present in `items`, holding 0 where the other active dimensions
 * exclude that actor's rows. Status and priority need no such treatment — the
 * sheet renders their rows from the workspace catalog, which is independent of
 * the current selection — but an actor row exists ONLY because some row
 * mentioned that actor, so building the key set from the faceted subset would
 * delete rows from the menu that offers them. Picking "status = done" would
 * then drop every actor with nothing done, including the one the user just
 * picked and now needs to switch off. Web builds the same universe separately
 * from the counts for the same reason (`inbox-filter-menu.tsx:177-193`),
 * unioning every key in the view before reading any count.
 */
export function inboxLocalFacets(
  items: readonly InboxItem[],
  filters: InboxFilters,
): InboxFacetCounts {
  const own = <K extends keyof InboxFilters>(dimension: K, cleared: InboxFilters[K]) =>
    filterInboxItems([...items], { ...filters, [dimension]: cleared });

  const actors: Record<string, number> = {};
  for (const item of items) {
    const key = inboxActorKey(item);
    if (key != null) actors[key] = 0;
  }
  for (const [key, count] of Object.entries(
    countsOf(own("actors", []), inboxActorKey),
  )) {
    actors[key] = count;
  }

  return {
    statuses: countsOf(own("statuses", []), (item) => item.issue_status ?? null),
    priorities: countsOf(
      own("priorities", []),
      (item) => item.issue_priority ?? null,
    ),
    actors,
    unreadCount: own("unreadOnly", false).filter((item) => item.read !== true)
      .length,
  };
}

/**
 * Which empty state the main list is in.
 *
 * The distinction is the whole point of the second value: "you filtered
 * everything away" and "there is nothing here" are different facts with
 * different ways out, and showing the second one for the first tells the user
 * their inbox is empty when it holds 339 rows they simply excluded. Web
 * branches the same way and, like this, lets the filtered case win even when
 * the underlying list is also empty
 * (`inbox-page.tsx:602-617`): with a filter active, "nothing matches" is the
 * true statement either way, and it is the one carrying the way out.
 *
 * The archived view has its own version of this (`archivedEmptyReason`) with a
 * third outcome, because a genuinely empty archive also bounces the reader back
 * to the main list. There is no such fallback here — the main list is home.
 */
export function mainInboxEmptyReason(input: {
  visibleCount: number;
  activeFilterCount: number;
}): "none" | "filtered" | "zero" {
  if (input.visibleCount > 0) return "none";
  return input.activeFilterCount > 0 ? "filtered" : "zero";
}
