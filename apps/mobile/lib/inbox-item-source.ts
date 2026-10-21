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
import { isIssueUuid } from "@multica/core/issues";

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

export type InboxItemPhase = "ready" | "loading" | "error" | "missing";

/**
 * `loading` covers the two windows in which "not found yet" is expected: the
 * workspace id is still resolving (it stays null until the workspaces list
 * answers, which is the whole cold-start window), and the list is in flight. A
 * found row wins over both, so a warm cache being revalidated never flashes.
 *
 * `error` is checked before `loading` for the reason `resolveCatalogState`
 * documents: a failed read reports `isFetching: false`, so on its own it reads
 * as settled-and-absent and the screen claimed 「这条通知已不可用。」 about a
 * notification that was merely unreachable. Failure outranks in-flight so a
 * spinner never hides a failure and its retry.
 */
export function inboxItemPhase(input: {
  hasItem: boolean;
  workspaceReady: boolean;
  fetching: boolean;
  /** Either backing list failed. Optional so the existing call sites (and the
   *  tests that predate it) keep their meaning: absent means "did not fail". */
  failed?: boolean;
}): InboxItemPhase {
  if (input.hasItem) return "ready";
  if (input.failed) return "error";
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

/**
 * Whether a still-missing archived notification is worth a DIRECT lookup
 * against the paged archive.
 *
 * The two list reads above are not enough for this screen, and the gap is
 * measurable rather than theoretical. Both are bounded:
 *
 *   - `/api/inbox/archived` applies a server-side LIMIT of 200 GROUPS
 *     (`ListArchivedInboxItems`). Measured on this deployment: 314 rows / 200
 *     groups returned against 1,287 archived groups.
 *   - `/api/inbox/archived/page` is cursor-paged, and this screen only ever
 *     reads page one (the bucket options carry no cursor).
 *
 * So an archived notification past the first page — or past the legacy cap
 * when the two lists are the only reads — is absent from both, and the screen
 * concludes 「这条通知已不可用。」 about a notification that exists. Confirmed
 * against the live server with a real deep link target: an archived
 * `autopilot_paused` row from 2026-09-29 was missing from the legacy list and
 * present when resolved by `group_id`. `group_id` is the server's own escape
 * hatch (`ListArchivedInboxPage` narrows to that group, index-backed, no
 * cursor needed).
 *
 * Only for `inbox-item/<id>`-shaped targets: the lookup narrows on
 * `COALESCE(issue_id, id)`, so it can only resolve a notification whose key IS
 * its own id — an issue-backed row is reached by issue id, and the id in the
 * URL is the notification's, not the issue's.
 *
 * `groupId` must be a canonical UUID: the server rejects anything else with a
 * 400 (`parseUUIDOrBadRequest`), so a malformed id is a client bug and the
 * honest response is not to spend a request proving it.
 */
export function shouldLookupArchivedItem(input: {
  workspaceReady: boolean;
  /** A row was found in one of the two lists — nothing to look up. */
  hasItem: boolean;
  /** Either list read failed: look nothing up until it settles. */
  failed: boolean;
  /** The lookup itself already failed — do not retry it in a render loop. */
  lookupFailed: boolean;
  /** The notification id from the deep link. */
  notificationId: string;
}): boolean {
  return (
    input.workspaceReady &&
    !input.hasItem &&
    !input.failed &&
    !input.lookupFailed &&
    isIssueUuid(input.notificationId)
  );
}
