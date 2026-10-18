/**
 * Pure view-model for the archived sub-view's paged list.
 *
 * The .tsx screen cannot run in the mobile vitest lane (Node only — see
 * `vitest.config.ts`), so the decisions that are easy to get wrong live here
 * and the screen only wires them to React Query. What is easy to get wrong,
 * specifically:
 *
 *   - **Deduplication across pages.** One issue can hold several archived
 *     notifications, and the cursor pages by time, so a group's rows can
 *     straddle a page boundary. Deduplicating each page on its own — the
 *     obvious reading of "dedupe the list" — renders the same issue twice,
 *     once per page. The dedup has to run over the concatenation.
 *   - **The entry-row count.** The main inbox's "Archived" row used to print
 *     the length of a server-capped list, which is a lower bound the user
 *     reads as a total. It now prints the archive's real size.
 *   - **Whether to say "no more".** A one-page archive and a one-page-deep
 *     reading of a large archive look identical from `hasMore` alone.
 */
import type { ArchivedInboxPage, InboxItem } from "@multica/core/types";
import { deduplicateArchivedInboxItems } from "@/lib/inbox-display";
import type { InboxPriorityFilterSupport } from "@/lib/inbox-filters";
import {
  actorNameState,
  SYSTEM_ACTOR_STATE,
  type ActorNameState,
  type ActorReadiness,
} from "@/lib/actor-name-state";

/**
 * Every archived row fetched so far, deduplicated by issue across pages.
 *
 * The dedup runs once over the concatenation, never per page — see the module
 * doc. `deduplicateArchivedInboxItems` is the same helper the single-page
 * archive always used (and web's `deduplicateArchivedInboxItems`), so the
 * comment-anchor handling that makes a row tap through to the right comment is
 * unchanged; only the input got longer.
 */
export function archivedRowsFromPages(
  pages: readonly ArchivedInboxPage[] | undefined,
): InboxItem[] {
  const flat = (pages ?? []).flatMap((page) => page.items);
  return deduplicateArchivedInboxItems(flat);
}

/**
 * The archive's real size, from the facet counts.
 *
 * Summed over the ACTOR dimension rather than status or priority, and that
 * choice is forced: status and priority are properties of the linked issue, so
 * an issue-less notification (a failed quick-create, an autopilot notice) has
 * neither and is absent from both. Every row has an actor — `system` included
 * — so the actor dimension is the only one that partitions the whole archive.
 * Measured against the live server: actor counts sum to the full page-drain
 * total (910), while status and priority each come up 6 short.
 *
 * Returns 0 for absent facets, which is the right answer for the entry row:
 * it hides itself at zero, and "we could not count" should not be drawn as a
 * number.
 */
export function archivedInboxTotal(
  facets: { actors: Record<string, number> } | undefined,
): number {
  if (!facets) return 0;
  let total = 0;
  for (const count of Object.values(facets.actors)) total += count;
  return total;
}

/**
 * The number the archive entry row prints, and whether it prints at all.
 *
 * The facets endpoint is the source of truth, but it is a SECOND endpoint on a
 * surface that used to need only one, so it can be missing: an installed app
 * talking to a server that predates it gets a 404 here while the capped list it
 * has always called still works. Rather than let the entry row disappear on
 * those servers, that list is read as a fallback — it is a lower bound, and a
 * lower bound that is labelled as a count is exactly the half-truth this
 * iteration is about, but it beats a row that vanishes and takes the archive
 * with it.
 *
 * Falling back is gated on the facets having actually FAILED, not on the total
 * being zero. Zero is a legitimate answer (an empty archive hides the row on
 * purpose), and treating it as "unavailable" would have the client issue a
 * second request on every load to re-learn that the archive is empty.
 */
export function archivedEntryCount(input: {
  /** Summed facet counts; 0 when the facets are absent. */
  facetTotal: number;
  /** True when the facets request failed — the only trigger for the fallback. */
  facetsUnavailable: boolean;
  /** Rows from the capped legacy list; undefined unless the fallback is on. */
  legacyRowCount: number | undefined;
}): number {
  if (!input.facetsUnavailable) return input.facetTotal;
  return input.facetTotal + (input.legacyRowCount ?? 0);
}

/**
 * Whether the request for the entry row's count was inconclusive — either the
 * facets failed, or a fallback read of the capped list did too. Only used to
 * decide whether to keep showing a number at all.
 */
export function archivedCountUnavailable(input: {
  facetsUnavailable: boolean;
  fallbackPending: boolean;
  fallbackUnavailable: boolean;
}): boolean {
  if (!input.facetsUnavailable) return false;
  return !input.fallbackPending && input.fallbackUnavailable;
}

/**
 * Whether the archived list can be filtered by priority.
 *
 * Always yes, and deliberately NOT derived from the returned rows — this is a
 * named function rather than a constant so the decision has one home and can
 * be tested against the bug that produced it (iteration 238, found on the
 * Pixel 5).
 *
 * The paged endpoint guarantees the projection: its SQL selects
 * `iss.priority AS issue_priority` for every row, including rows with no
 * linked issue (which serialize `null`). Measured against the live server over
 * the unfiltered archive and four filter combinations: 938 rows, 0 missing the
 * key. So the main inbox's capability probe — `inboxPriorityFilterSupport`,
 * which reads the rows because `/api/inbox` predates the column, and whose
 * "unknown" answer causes `inboxFiltersForPrioritySupport` to STRIP a priority
 * selection — must not be applied here.
 *
 * Applying it anyway was the bug. A response the priority filter emptied
 * reports "unknown", the strip removed the selection from the screen's display
 * copy while the request kept it, and the user saw a list fetched with
 * `priorities=urgent` labelled 910 with no filter badge. Web reaches the same
 * conclusion by hardcoding `"supported"` for this view
 * (`packages/views/inbox/components/inbox-page.tsx:151`).
 */
export function archivedPriorityFilterSupport(): InboxPriorityFilterSupport {
  return "supported";
}

/**
 * Whether a continuation has actually been fetched — i.e. the footer's "no
 * more" line has something to be about.
 *
 * `pageCount > 1` is the test: with a single page loaded, `hasMore: false`
 * means "this archive fits in 50 rows or fewer", and printing an end-of-list
 * marker under six rows is noise. Once the user has followed at least one
 * continuation, reaching the end is real information.
 */
export function hasPagedBeyondFirst(pageCount: number): boolean {
  return pageCount > 1;
}

/**
 * Whether the empty state on screen is "nothing matched your filters" rather
 * than "your archive is empty".
 *
 * Filtered-to-nothing must never take the empty-archive path: that path shows
 * the copy about archiving from the main inbox and (in the screen) flips the
 * user back to the main list, so a filter with no matches would silently eject
 * them from the archive they were reading. With a filter active the list stays
 * put and says so, with a way to clear.
 */
export function archivedEmptyReason(input: {
  visibleCount: number;
  activeFilterCount: number;
}): "none" | "filtered" | "archive" {
  if (input.visibleCount > 0) return "none";
  return input.activeFilterCount > 0 ? "filtered" : "archive";
}

/**
 * One row of the archived filters' "From" section — the actor facet chips.
 *
 * Iteration 257 (MYS-2228). This section used to print `getName(...)` straight
 * into the row's label, which on a cold start meant every actor chip read
 * 「Unknown」. The same string was ALSO the sort key
 * (`.sort((a, b) => a.name.localeCompare(b.name))`), which made the two
 * failures arrive together: a fallback word asserted as a fact, and a list
 * whose ORDER depended on which directories had answered — on a partial cache
 * (members resolved, agents not) the resolved and unread rows interleave, and
 * every directory that lands reshuffles the sheet under the user's finger.
 *
 * So the two are split, exactly as iteration 256 split them for the projects
 * list's lead chips (`leadFilterOptions`, `lib/filter-projects.ts`):
 *
 *   - `label` is what may be SAID — `null` while the directory that would
 *     answer for this actor has not settled. The row then draws a load mark
 *     where the name goes (`AttributeChip`'s convention), because a chip is a
 *     standalone text node: nothing forces the whole row to retreat, and the
 *     count beside it is a measurement of the archive rather than of a
 *     directory, so it stays true and stays visible.
 *   - `sortKey` is a stable per-reference key — the actor's own `type:id`,
 *     never the label. Readiness cannot touch it, so all three snapshots
 *     (cold / half-read / fully-read) order the rows identically.
 *
 * `system` is a constant, not a read: no directory can ever answer for it
 * (`SYSTEM_ACTOR_NAME`), and its rows must not wait on one.
 */
export interface ArchivedActorFilterRow {
  /** The facet's composite `type:id` key — also the filter's own value. */
  key: string;
  type: string;
  id: string;
  /** The name to print, or `null` while it may not be stated. Never a
   *  fallback word: 「Unknown」 is the claim this exists to withhold. */
  label: string | null;
  /** Stable ordering key. Deliberately `key`, not `label`. */
  sortKey: string;
  /** The facet's count, or 0 when the facets have not answered. Always a fact
   *  about the archive — never about a directory. */
  count: number;
}

/**
 * The "From" section's rows: the facet universe UNION the current selection
 * (so picking one actor never removes the others from the list offering them),
 * resolved through the read-state decision and sorted on a stable key.
 *
 * The union is taken on the composite key, which is what the facets endpoint
 * and the filter store both use (`lib/inbox-filters.ts`), so a selected actor
 * whose count has since dropped to zero still gets a row — the checkbox has to
 * stay reachable to switch it off.
 */
export function archivedActorFilterRows(input: {
  /** Facet counts by actor key; `undefined` while the facets are in flight. */
  facetActors: Record<string, number> | undefined;
  /** The current selection's actor keys. */
  selected: readonly string[];
  readiness: ActorReadiness;
  /** The directory lookup, in `getName`'s shape. Only consulted for a type
   *  whose directory settled — `actorNameState` decides that. */
  nameOf: (type: string, id: string) => string;
  /** The `system` bucket's label ("From"). A constant, so it is stated at any
   *  time. */
  systemLabel: string;
}): ArchivedActorFilterRow[] {
  const { facetActors, selected, readiness, nameOf, systemLabel } = input;
  const keys = [
    ...new Set<string>([...Object.keys(facetActors ?? {}), ...selected]),
  ];

  return keys
    .map((key) => {
      const separator = key.indexOf(":");
      const type = separator === -1 ? key : key.slice(0, separator);
      const id = separator === -1 ? "" : key.slice(separator + 1);
      const state: ActorNameState =
        type === "system"
          ? SYSTEM_ACTOR_STATE
          : actorNameState({ type, id, name: nameOf(type, id), readiness });
      const settled = state.kind !== "unsettled";
      return {
        key,
        type,
        id,
        label: !settled
          ? null
          : type === "system"
            ? systemLabel
            : state.name,
        sortKey: key,
        count: facetActors?.[key] ?? 0,
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}
