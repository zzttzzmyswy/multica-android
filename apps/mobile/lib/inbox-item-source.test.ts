import { describe, expect, it } from "vitest";
import {
  inboxItemBuckets,
  inboxItemPhase,
  shouldFetchFallback,
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
