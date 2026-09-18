/**
 * Which inbox list backs the inbox-item detail screen, and whether that screen
 * is loading or genuinely looking at a notification that is gone.
 *
 * The screen is reachable by deep link (`inbox-item/<id>`), so it can mount
 * with a cold query cache: nothing has listed the notification in this process.
 * Reading only the cache made that case indistinguishable from a deleted
 * notification, and the screen rendered the missing state on every cold link.
 * The decision is pure so it can be tested in the Node lane — the .tsx only
 * wires the result to `useQuery`.
 */
import type { InboxBucket } from "@/data/queries/inbox";

export type { InboxBucket };

/**
 * Lists to read for a given `view` param, most specific first. `view` names the
 * list the reader was in, because the archive toggle reverses with it; anything
 * unrecognised reads the main list. Both lists are warmed by the inbox tab, so
 * the second entry answers for a tap-then-push whose row lives in the other
 * list.
 */
export function inboxItemBuckets(view: string | undefined): [InboxBucket, InboxBucket] {
  const primary: InboxBucket = view === "archived" ? "archived" : "inbox";
  return [primary, primary === "archived" ? "inbox" : "archived"];
}

export type InboxItemPhase = "ready" | "loading" | "missing";

/**
 * `loading` covers the two windows in which "not found yet" is expected: the
 * workspace id is still resolving (it stays null until the workspaces list
 * answers, which is the whole cold-start window), and the list is in flight. A
 * found row wins over both, so a warm cache being revalidated never flashes.
 */
export function inboxItemPhase(input: {
  hasItem: boolean;
  workspaceReady: boolean;
  fetching: boolean;
}): InboxItemPhase {
  if (input.hasItem) return "ready";
  if (!input.workspaceReady || input.fetching) return "loading";
  return "missing";
}

/**
 * Whether the second list is worth fetching. Deferred until the primary has
 * settled without the row: an archived notification opened from a deep link
 * carries no `view` param, so the main list misses it and only the archive
 * holds it — but fetching both on every cold link would double the requests
 * for the common case.
 */
export function shouldFetchFallback(input: {
  workspaceReady: boolean;
  primarySettled: boolean;
  hasPrimaryItem: boolean;
}): boolean {
  return input.workspaceReady && input.primarySettled && !input.hasPrimaryItem;
}
