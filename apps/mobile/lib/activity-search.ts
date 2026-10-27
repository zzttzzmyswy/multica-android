/**
 * The ONE producer of an activity row's text — used both by the row that draws
 * it and by in-page find's haystack (MYS-2109).
 *
 * Why this module exists rather than the row calling `formatActivity` directly:
 * find indexes an activity row by its *rendered* text. If the row and the
 * haystack each assembled that text themselves, the two could drift — and the
 * whole point of indexing activities is that the words find reports are the
 * words on screen. A second formatter is the exact failure this project already
 * paid for once: a probe that re-implemented a formatter reported a word that
 * was not on screen and "proved" a gap that did not exist. One implementation,
 * two consumers.
 *
 * ## Two runs, not one string
 *
 * The text comes back as `{ actor, verb }` because that is how the row draws it
 * and how web's DOM holds it:
 *
 *   - web renders the actor name and the verb in two sibling `<span>`s
 *     (`packages/views/issues/components/issue-detail.tsx:601-602`), so web's
 *     text-node walk confines a match to one of them — a query straddling the
 *     name/verb boundary is not found in a browser;
 *   - mobile draws the same two runs as nested `<Text>`s inside one line.
 *
 * Returning them separately lets find treat each as its own block, which
 * reproduces that confinement instead of being more permissive than the
 * browser. `lib/issue-find.ts` documents block granularity as its unit of
 * confinement and claims mobile is "identical across blocks"; this keeps that
 * claim true.
 *
 * ## What is NOT in the text
 *
 * The `×N` coalesce chip and the relative timestamp, both of which the row also
 * draws. They are chrome derived from the viewing moment rather than from the
 * entry — "2 days ago" becomes "3 days ago" with no data change, so indexing it
 * would put words in the haystack that no fixture can pin and that move under a
 * stable query. Web reaches both only as a side effect of walking raw DOM
 * nodes; this is a documented, one-directional divergence (mobile finds less
 * here, never more). `lib/issue-find.ts` lists it with the rest.
 *
 * NOT pure-pure: `formatActivity` resolves through the shared zh/en dictionary
 * and an injected status-label resolver. `lib/issue-find.ts` stays free of that
 * by taking this module's output as an injected parameter rather than importing
 * it — so the find lane keeps running under plain Node.
 *
 * ## The actor resolver is read-state-aware (iteration 255)
 *
 * The actor run is drawn through `components/ui/actor-name.tsx`, which paints a
 * skeleton rather than a name while the workspace directory is still being
 * read. So the haystack cannot hold a name then either: `deps.resolveActorName`
 * returns the three-state decision, not a string, and an unsettled actor
 * contributes an EMPTY run which `activityBlockIndex` drops. The alternative —
 * indexing `getName`'s 「Unknown」 fallback — would make find report a word that
 * is nowhere on the screen, the precise drift this module exists to prevent.
 */
import type { TimelineEntry } from "@multica/core/types";
import { formatActivity } from "./format-activity";
import { coalesceTimeline } from "./timeline-coalesce";
import { actorNameText, type ActorNameState } from "./actor-name-state";

/**
 * How a row's actor reference resolves, for BOTH of this module's consumers.
 *
 * Returns the three-state decision rather than a string because the row may
 * not state a name it has not read (`lib/actor-name-state.ts`). The string
 * form is taken here, once, by `actorNameText` — so the row and the find index
 * still cannot drift: an unsettled actor contributes an empty run to BOTH, and
 * find skips empty runs (`activityBlockIndex` filters them out).
 *
 * That is the whole contract, and it is why this deps type carries the state
 * type instead of `string`: a resolver typed `=> string` would have to make
 * the "name or nothing" decision somewhere, and "somewhere" is exactly how the
 * drawn text and the haystack end up disagreeing.
 */
export type ResolveActorNameState = (
  type: string | null | undefined,
  id: string | null | undefined,
) => ActorNameState;

/** The resolvers the row itself works from: `useActorLookup().resolveActorName`
 *  and `useStatusLabel()`, threaded in so this module needs no React. */
export interface ActivityTextDeps {
  /**
   * Resolve an actor (member / agent / squad) to the read-state-aware decision
   * the row draws — NOT to a string. While the directory has not answered the
   * row paints a load state and says no name, so this module must produce no
   * name either: putting the `getName` fallback (「Unknown」) into the haystack
   * would let find report a word that is not on screen, which is the exact
   * class of bug this module was written to prevent (MYS-2109).
   *
   * The caller rebuilds the index when the directories settle by depending on
   * this function's (memoised) identity — `useActorLookup` memoises it on the
   * data, so the index follows the read.
   */
  resolveActorName: ResolveActorNameState;
  /** Status key → localized label. Omitted, a built-in key still resolves
   *  through i18n via `issueStatusLabel`. */
  statusLabel?: (statusKey: string) => string;
  /**
   * BCP-47 tag for the app locale (`getIntlLocale()`), for the wakeup sentences
   * that embed an absolute instant.
   *
   * Required for the same reason `WakeupTextDeps.locale` is: this haystack has
   * to hold the words the row DRAWS. Defaulting to the device locale here would
   * make find report 「Oct 20, 04:00 AM」 on a Chinese screen — a hit the reader
   * cannot see, which is the exact drift this module exists to prevent
   * (MYS-2429).
   */
  locale: string;
}

/** The string form `formatActivity` interpolates. An unsettled actor is the
 *  empty string there, which `formatActivity`'s own `|| id` fallbacks and
 *  `assignee_changed`'s truthiness check already handle (see the docblock on
 *  `activityRowText`).
 *
 *  The last-resort `id` is deliberate: `formatActivity`'s wakeup sentences
 *  read as broken English with a hole in them ("woke  now"), and a raw id at
 *  least identifies WHICH actor the sentence is about — the same reasoning
 *  `actorNameState`'s `gone` branch uses for its id fragment. It applies only
 *  where the sentence has nowhere else to put the reference; the row's own
 *  name run stays empty, so find cannot match an id the screen never shows in
 *  that position.
 */
function nameForSentence(
  resolve: ResolveActorNameState,
  type: string | null | undefined,
  id: string | null | undefined,
): string {
  return actorNameText(resolve(type, id)) || (id ?? "");
}

/** The row's text runs, in the order they read on screen. */
export interface ActivityRowText {
  /** The actor's name — the `font-medium` run. */
  actor: string;
  /** The verb (`formatActivity`). Empty when the entry carries no inline text
   *  at all, in which case the row draws nothing after the name. */
  verb: string;
}

/**
 * The text one activity row draws, as its two runs.
 *
 * Height and colour live in `components/issue/activity-row.tsx`; this is only
 * the string. The row and the find index both call it, which is what makes
 * "searched text == drawn text" structural rather than a thing to remember.
 */
export function activityRowText(
  entry: TimelineEntry,
  deps: ActivityTextDeps,
): ActivityRowText {
  return {
    // The `font-medium` run. Empty while the actor's directory has not
    // answered — the row draws a skeleton there, and a skeleton is not a word
    // to search for.
    actor: actorNameText(deps.resolveActorName(entry.actor_type, entry.actor_id)),
    verb: formatActivity(
      entry,
      (type, id) => nameForSentence(deps.resolveActorName, type, id),
      { statusLabel: deps.statusLabel, locale: deps.locale },
    ),
  };
}

/**
 * Searchable text for the activity rows of a timeline, keyed by ROW id.
 *
 * `entries` is the RAW timeline — the same array the screen reads — and this
 * function applies the same `coalesceTimeline` the list applies. Two reasons
 * that matters, and neither is cosmetic:
 *
 *   1. **The verb depends on coalescing.** A merged run renders
 *      "completed 3 tasks", not "completed a task" — `formatActivity` reads
 *      `coalesced_count`. Text built from the raw entry would put a sentence in
 *      the haystack that is nowhere on screen.
 *   2. **A merged-away entry renders no row.** Coalescing keeps only the newest
 *      entry's `id` (`lib/timeline-coalesce.ts:74-79`). Indexing the raw list
 *      would count hits for entries that have no row, so `matchCount` would
 *      promise steps the reader cannot take: `stepMatch` would hand
 *      `TimelineList` an id that resolves no row, and its find effect returns
 *      without committing its stamp — the "next" button would look dead. The
 *      docblock of `lib/issue-find.ts` names exactly this as the reason
 *      activities were excluded before. The answer is to index the rendered
 *      rows, not to keep excluding them.
 *
 * On this deployment that is 3 merged rows out of 215 activities across 40
 * issues — small, but the failure it causes is a lie about the count, so it is
 * handled rather than argued away.
 *
 * Ordering is safe because a coalesced run is contiguous: the survivor sits at
 * the run's position relative to every other row, so walking the raw entries in
 * order yields the same activity sequence the list draws.
 *
 * One entry in the map per rendered row; two strings per row (the two runs).
 * Entries the row's own renderer drops entirely — there are none today, but a
 * future action could render nothing — yield an empty array, and find skips
 * empty strings.
 */
export function activityBlockIndex(
  entries: readonly TimelineEntry[] | undefined,
  deps: ActivityTextDeps,
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  if (!entries || entries.length === 0) return index;
  for (const entry of coalesceTimeline([...entries])) {
    if (entry.type !== "activity") continue;
    const { actor, verb } = activityRowText(entry, deps);
    index.set(
      entry.id,
      [actor, verb].filter((text) => text.length > 0),
    );
  }
  return index;
}
