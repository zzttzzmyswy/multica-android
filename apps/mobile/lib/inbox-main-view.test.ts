/**
 * The MAIN inbox's filter layer, exercised directly.
 *
 * The archived view's filter tests live in `inbox-filters.test.ts`; what is
 * different here is the COUNT SOURCE. Web branches on it
 * (`inbox-filter-menu.tsx:173-176`: server facets for the archive, local
 * counts for the main list) and mobile now does too, so the branch itself is
 * what needs pinning — specifically the two ways a local facet pass goes wrong
 * without looking wrong:
 *
 *   - counting over the unfiltered list, which prints numbers that do not move
 *     as the user narrows and then disagree with the list they produce;
 *   - counting a dimension with its OWN selection applied, which reports the
 *     visible total (0 or N) instead of "how many rows selecting this would
 *     reveal" — a filter that reads "0 unread" the moment it is switched on.
 */
import { describe, expect, it } from "vitest";
import type { InboxItem } from "@multica/core/types";
import { EMPTY_INBOX_FILTERS, type InboxFilters } from "./inbox-filters";
import { inboxLocalFacets, mainInboxEmptyReason } from "./inbox-main-view";

function row(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "i1",
    workspace_id: "ws-1",
    recipient_type: "member",
    recipient_id: "m1",
    actor_type: "agent",
    actor_id: "a1",
    type: "new_comment",
    severity: "info",
    issue_id: "issue-1",
    title: "t",
    body: null,
    issue_status: "done",
    issue_priority: "high",
    read: true,
    archived: false,
    created_at: "2026-08-01T00:00:00Z",
    details: null,
    ...overrides,
  };
}

function filters(overrides: Partial<InboxFilters> = {}): InboxFilters {
  return { ...EMPTY_INBOX_FILTERS, ...overrides };
}

describe("inboxLocalFacets", () => {
  it("counts every row of an unfiltered list", () => {
    const items = [
      row({ id: "1", issue_status: "done", issue_priority: "high" }),
      row({ id: "2", issue_status: "todo", issue_priority: "low" }),
      row({ id: "3", issue_status: "done", issue_priority: "high" }),
    ];
    const facets = inboxLocalFacets(items, EMPTY_INBOX_FILTERS);
    expect(facets.statuses).toEqual({ done: 2, todo: 1 });
    expect(facets.priorities).toEqual({ high: 2, low: 1 });
    expect(facets.actors).toEqual({ "agent:a1": 3 });
    expect(facets.unreadCount).toBe(0);
  });

  it("counts unread rows without applying the unread flag to itself", () => {
    // The failure this pins: a count computed with `unreadOnly` applied would
    // read "0" the instant the user ticks the box (nothing is selected yet in
    // a list that only shows unread rows it already has), so the one number
    // that justifies the toggle would vanish exactly when it is used.
    const items = [
      row({ id: "1", read: false }),
      row({ id: "2", read: false }),
      row({ id: "3", read: true }),
    ];
    expect(inboxLocalFacets(items, EMPTY_INBOX_FILTERS).unreadCount).toBe(2);
    expect(
      inboxLocalFacets(items, filters({ unreadOnly: true })).unreadCount,
    ).toBe(2);
  });

  it("counts unread rows, not all matching rows", () => {
    // The other half of the same step, and the one the test above cannot see:
    // clearing the flag and then forgetting the second step — counting every
    // row that survived — prints the visible total as the unread count. It
    // reads as "3 unread" over a list holding one unread row, and it makes the
    // toggle look like it did nothing, because the number it advertises is the
    // number of rows already on screen.
    const items = [
      row({ id: "1", read: false }),
      row({ id: "2", read: true }),
      row({ id: "3", read: true }),
    ];
    expect(inboxLocalFacets(items, EMPTY_INBOX_FILTERS).unreadCount).toBe(1);
  });

  it("has each dimension respect the OTHERS while ignoring itself", () => {
    // The faceted rule, from web's `inbox-filter-menu.tsx:139-153`. With
    // "status = done" active, the STATUS counts still describe the whole list
    // (2 done, 1 todo) while every other dimension is narrowed to it.
    const items = [
      row({ id: "1", issue_status: "done", issue_priority: "high", actor_id: "a1" }),
      row({ id: "2", issue_status: "done", issue_priority: "low", actor_id: "a2" }),
      row({ id: "3", issue_status: "todo", issue_priority: "high", actor_id: "a1" }),
    ];
    const facets = inboxLocalFacets(items, filters({ statuses: ["done"] }));
    // Own dimension: unfiltered by itself, so switching back stays possible.
    expect(facets.statuses).toEqual({ done: 2, todo: 1 });
    // Other dimensions: narrowed.
    expect(facets.priorities).toEqual({ high: 1, low: 1 });
    expect(facets.actors).toEqual({ "agent:a1": 1, "agent:a2": 1 });
  });

  it("keeps every actor as a row even when other filters exclude it", () => {
    // The actor universe, web's `inbox-filter-menu.tsx:177-193`. An actor row
    // exists only because a row mentioned that actor, so a faceted key set
    // would DELETE the rows for every actor the current selection excludes —
    // including the actor the user just picked, leaving no way to unpick it.
    const items = [
      row({ id: "1", actor_id: "a1", issue_status: "done" }),
      row({ id: "2", actor_id: "a2", issue_status: "todo" }),
    ];
    const facets = inboxLocalFacets(items, filters({ statuses: ["done"] }));
    expect(Object.keys(facets.actors).sort()).toEqual(["agent:a1", "agent:a2"]);
    expect(facets.actors["agent:a2"]).toBe(0);
    expect(facets.actors["agent:a1"]).toBe(1);
  });

  it("ignores rows with no value for a dimension instead of bucketing them", () => {
    // An issue-less notification has no status and no priority. `filterInboxItems`
    // excludes it from any selection on those dimensions, so counting it under
    // a key would offer a row that selecting it then removes.
    const items = [
      row({ id: "1", issue_status: null, issue_priority: null, actor_type: null, actor_id: null }),
      row({ id: "2", issue_status: "done", issue_priority: "high" }),
    ];
    const facets = inboxLocalFacets(items, EMPTY_INBOX_FILTERS);
    expect(facets.statuses).toEqual({ done: 1 });
    expect(facets.priorities).toEqual({ high: 1 });
    expect(facets.actors).toEqual({ "agent:a1": 1 });
  });

  it("collapses every system notification into one actor bucket", () => {
    const items = [
      row({ id: "1", actor_type: "system", actor_id: null }),
      row({ id: "2", actor_type: "system", actor_id: null }),
    ];
    expect(inboxLocalFacets(items, EMPTY_INBOX_FILTERS).actors).toEqual({
      system: 2,
    });
  });

  it("is empty, not wrong, on an empty list", () => {
    // The main view counts what it holds; holding nothing is a legitimate
    // answer here (the archive's capability probe has the opposite problem).
    const facets = inboxLocalFacets([], EMPTY_INBOX_FILTERS);
    expect(facets.statuses).toEqual({});
    expect(facets.priorities).toEqual({});
    expect(facets.actors).toEqual({});
    expect(facets.unreadCount).toBe(0);
  });

  it("does not mutate the list it counts", () => {
    const items = [row({ id: "1", issue_status: "done" })];
    inboxLocalFacets(items, filters({ statuses: ["done"] }));
    expect(items).toHaveLength(1);
    expect(items[0]?.issue_status).toBe("done");
  });
});

/**
 * Iteration 264 (MYS-2291): the idle dimension's COUNT.
 *
 * Web counts it with the flag left ON rather than cleared-and-recounted
 * (`inbox-filter-menu.tsx:170-173`) — the one dimension where that is the right
 * shape, because "how many rows turning this on reveals" and "how many are left
 * once it is on" are the same question for a boolean. What it needs from the
 * client, though, is the agent-task snapshot, and that arrives asynchronously.
 */
describe("inboxLocalFacets — the idle count", () => {
  const busy = new Set(["issue-busy"]);

  it("counts the rows turning the dimension on would leave", () => {
    const items = [
      row({ id: "1", issue_id: "issue-1" }),
      row({ id: "2", issue_id: "issue-2" }),
      row({ id: "3", issue_id: "issue-busy" }),
    ];
    expect(
      inboxLocalFacets(items, EMPTY_INBOX_FILTERS, { activeIssueIds: busy })
        .idleCount,
    ).toBe(2);
  });

  it("is undefined, not 0, while the snapshot is unresolved", () => {
    // The difference is user-visible: `0` beside "no agents working" says the
    // filter would reveal nothing, and every row is in fact unknown. The sheet
    // prints no count for `undefined` (the same rule it applies to a 0), but
    // the decision is made here so no caller has to guess.
    const items = [row({ id: "1", issue_id: "issue-1" })];
    expect(
      inboxLocalFacets(items, EMPTY_INBOX_FILTERS, { activeIssueIds: undefined })
        .idleCount,
    ).toBeUndefined();
    expect(
      inboxLocalFacets(items, EMPTY_INBOX_FILTERS, { activeIssueIds: new Set() })
        .idleCount,
    ).toBe(1);
  });

  it("respects the OTHER dimensions, like every other count", () => {
    const items = [
      row({ id: "1", issue_id: "issue-1", issue_priority: "high" }),
      row({ id: "2", issue_id: "issue-2", issue_priority: "low" }),
      row({ id: "3", issue_id: "issue-busy", issue_priority: "high" }),
    ];
    expect(
      inboxLocalFacets(items, filters({ priorities: ["high"] }), {
        activeIssueIds: busy,
      }).idleCount,
    ).toBe(1);
  });

  it("leaves the other four counts narrowed by an ACTIVE idle selection", () => {
    // The failure this pins: threading the snapshot into the idle count only.
    // With the dimension switched on, every other count is computed through
    // the same predicate — which fails closed without the set — and would
    // print 0 beside every status and actor still on offer.
    const items = [
      row({ id: "1", issue_id: "issue-1", issue_status: "done", actor_id: "a1" }),
      row({ id: "2", issue_id: "issue-busy", issue_status: "todo", actor_id: "a2" }),
    ];
    const facets = inboxLocalFacets(items, filters({ idleOnly: true }), {
      activeIssueIds: busy,
    });
    expect(facets.statuses).toEqual({ done: 1 });
    expect(facets.actors["agent:a1"]).toBe(1);
    expect(facets.actors["agent:a2"]).toBe(0);
    expect(facets.idleCount).toBe(1);
  });
});

describe("mainInboxEmptyReason", () => {
  it("stays out of the way while rows are showing", () => {
    expect(mainInboxEmptyReason({ visibleCount: 3, activeFilterCount: 2 })).toBe(
      "none",
    );
  });

  it("calls an empty list with no filter the zero state", () => {
    expect(mainInboxEmptyReason({ visibleCount: 0, activeFilterCount: 0 })).toBe(
      "zero",
    );
  });

  it("calls an empty list with a filter the filtered state", () => {
    // The whole reason the two are separate: 339 groups exist, the selection
    // hides all of them, and "your inbox is empty" would be a lie with no way
    // out of it.
    expect(mainInboxEmptyReason({ visibleCount: 0, activeFilterCount: 1 })).toBe(
      "filtered",
    );
  });

  it("prefers the filtered reading when both could apply", () => {
    // An inbox that is genuinely empty AND filtered: "nothing matches" is the
    // true statement either way, and it is the one carrying the clear action.
    // Matches web, where `hasActiveFilters` wins the label
    // (`inbox-page.tsx:602-617`).
    expect(mainInboxEmptyReason({ visibleCount: 0, activeFilterCount: 4 })).toBe(
      "filtered",
    );
  });
});
