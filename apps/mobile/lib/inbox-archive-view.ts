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
