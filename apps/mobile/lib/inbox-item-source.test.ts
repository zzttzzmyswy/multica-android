import { describe, expect, it } from "vitest";
import {
  inboxItemBuckets,
  inboxItemPhase,
  shouldFetchFallback,
  shouldLookupArchivedItem,
} from "./inbox-item-source";

/**
 * The inbox-item detail screen is reachable by deep link, so it can mount with
 * a cold query cache — the notification it names was never listed in this
 * process. The 141 round measured the result on both devices: the screen showed
 * 「这条通知已不可用。」 on every cold link, because it read the row out of the
 * React Query cache and an empty cache was indistinguishable from a deleted
 * notification.
 *
 * The screen is a .tsx and cannot run in the Node-only lane, so the decision —
 * which list to read, whether to fetch, and which of the three states to
 * render — lives here and the screen only wires it to `useQuery`.
 */

describe("inbox item source: which list backs the screen", () => {
  it("reads the main list first when the reader did not come from the archive", () => {
    expect(inboxItemBuckets(undefined)).toEqual(["inbox", "archived"]);
  });

  it("reads the archived list first when the reader came from the archive", () => {
    // The archive toggle reverses with the view the reader was in, so the row
    // has to be found in the list they were actually looking at.
    expect(inboxItemBuckets("archived")).toEqual(["archived", "inbox"]);
  });

  it("keeps the other list as a fallback for both views", () => {
    // Both lists are warmed by the inbox tab, so a tap-then-push always finds
    // its row even when the view param and the list disagree.
    for (const view of [undefined, "inbox", "archived"]) {
      const [primary, fallback] = inboxItemBuckets(view);
      expect(fallback).not.toBe(primary);
    }
  });
});

describe("inbox item source: loading is not missing", () => {
  it("waits while the workspace id is still resolving, instead of claiming the row is gone", () => {
    // Cold start: the deep link carries the slug, but currentWorkspaceId stays
    // null until the workspaces list resolves. That window is exactly where
    // the 141 round saw the missing state.
    expect(
      inboxItemPhase({ hasItem: false, workspaceReady: false, fetching: false }),
    ).toBe("loading");
  });

  it("waits while the list is being fetched", () => {
    expect(
      inboxItemPhase({ hasItem: false, workspaceReady: true, fetching: true }),
    ).toBe("loading");
  });

  it("reports the notification as missing only once the lists settled without it", () => {
    expect(
      inboxItemPhase({ hasItem: false, workspaceReady: true, fetching: false }),
    ).toBe("missing");
  });

  it("renders the row as soon as it is found, even mid-fetch", () => {
    // A warm cache that is being revalidated must not flash the spinner.
    expect(
      inboxItemPhase({ hasItem: true, workspaceReady: true, fetching: true }),
    ).toBe("ready");
  });

  it("reports a failed read as a failure, not as a missing notification", () => {
    // MYS-1916: the screen had no failure branch, so a list read that errored
    // (isFetching false, data undefined) rendered 「这条通知已不可用。」 — the user
    // was told the notification was gone rather than unreachable.
    expect(
      inboxItemPhase({
        hasItem: false,
        workspaceReady: true,
        fetching: false,
        failed: true,
      }),
    ).toBe("error");
  });

  it("prefers the failure over the spinner when a read both failed and is retrying", () => {
    // A manual refetch after a failure reports `isFetching: true` again; showing
    // a spinner there hides the failure and the retry that produced it.
    expect(
      inboxItemPhase({
        hasItem: false,
        workspaceReady: true,
        fetching: true,
        failed: true,
      }),
    ).toBe("error");
  });

  it("still renders a found row over a failure in the other list", () => {
    // The row is in one list; the other list failing does not unsay that.
    expect(
      inboxItemPhase({
        hasItem: true,
        workspaceReady: true,
        fetching: false,
        failed: true,
      }),
    ).toBe("ready");
  });
});

describe("inbox item source: fetching the fallback list", () => {
  it("does not fetch the fallback before the workspace id resolves", () => {
    expect(
      shouldFetchFallback({
        workspaceReady: false,
        primarySettled: false,
        hasPrimaryItem: false,
      }),
    ).toBe(false);
  });

  it("does not fetch the fallback while the primary list is still in flight", () => {
    // Two concurrent list fetches on every cold link would be wasteful; the
    // primary answers for the overwhelming majority of notifications.
    expect(
      shouldFetchFallback({
        workspaceReady: true,
        primarySettled: false,
        hasPrimaryItem: false,
      }),
    ).toBe(false);
  });

  it("fetches the fallback once the primary settled without the row", () => {
    // An archived notification opened from a deep link has no `view` param, so
    // the primary (main) list misses it and only the archive holds it.
    expect(
      shouldFetchFallback({
        workspaceReady: true,
        primarySettled: true,
        hasPrimaryItem: false,
      }),
    ).toBe(true);
  });

  it("does not fetch the fallback when the primary already has the row", () => {
    expect(
      shouldFetchFallback({
        workspaceReady: true,
        primarySettled: true,
        hasPrimaryItem: true,
      }),
    ).toBe(false);
  });
});

/**
 * The third read: `group_id` against the paged archive.
 *
 * The two list reads are both bounded, so "absent from both" is not the same
 * answer as "not there". Measured against mu.zztweb.top while writing this:
 * `/api/inbox/archived` returned 314 rows / 200 groups against 1,287 archived
 * groups, and an archived `autopilot_paused` notification from 2026-09-29 was
 * absent from it while `?group_id=<id>` returned exactly that row. Without
 * this gate the screen reports 「这条通知已不可用。」 about a notification the
 * server can still produce.
 */
describe("shouldLookupArchivedItem", () => {
  const ID = "01a0ec21-230f-751f-bf94-057353fb8d55";
  const base = {
    workspaceReady: true,
    hasItem: false,
    failed: false,
    lookupFailed: false,
    notificationId: ID,
  };

  it("fires once both lists missed and the id is a UUID", () => {
    expect(shouldLookupArchivedItem(base)).toBe(true);
  });

  it("stays off when a row was already found", () => {
    // Nothing to resolve, and a lookup here would be a request whose answer is
    // discarded.
    expect(shouldLookupArchivedItem({ ...base, hasItem: true })).toBe(false);
  });

  it("stays off while the workspace id is unresolved", () => {
    expect(shouldLookupArchivedItem({ ...base, workspaceReady: false })).toBe(false);
  });

  it("stays off when a list read failed — a failure is not an absence", () => {
    // Otherwise "the archive request 500'd" renders as "this notification is
    // gone", which is the exact conflation `inboxItemPhase` exists to prevent.
    expect(shouldLookupArchivedItem({ ...base, failed: true })).toBe(false);
  });

  it("stays off after the lookup itself failed, so it cannot loop", () => {
    expect(shouldLookupArchivedItem({ ...base, lookupFailed: true })).toBe(false);
  });

  it("refuses a non-UUID id — the server answers 400 to one", () => {
    // `ListArchivedInboxPage` calls parseUUIDOrBadRequest on group_id, so a
    // slug or an empty id does not "try anyway": it guarantees a 400 that the
    // screen would then render as an unavailable notification.
    expect(shouldLookupArchivedItem({ ...base, notificationId: "MUL-123" })).toBe(false);
    expect(shouldLookupArchivedItem({ ...base, notificationId: "" })).toBe(false);
  });
});
