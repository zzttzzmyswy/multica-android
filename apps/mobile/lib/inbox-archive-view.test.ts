/**
 * The archived view's paging view-model.
 *
 * Cross-page deduplication is the defect this file exists to pin: one issue
 * can hold several archived notifications, the cursor pages by time, so a
 * group's rows can straddle a page boundary — and deduplicating each page
 * separately, which is what "dedupe the list" reads like, renders the issue
 * twice. The count and the empty-state selection have their own traps, both
 * documented at their functions.
 */
import { describe, expect, it } from "vitest";
import type { ArchivedInboxPage, InboxItem } from "@multica/core/types";
import {
  archivedActorFilterRows,
  archivedCountUnavailable,
  archivedEmptyReason,
  archivedEntryCount,
  archivedInboxTotal,
  archivedPriorityFilterSupport,
  archivedRowsFromPages,
  hasPagedBeyondFirst,
} from "./inbox-archive-view";
import { inboxFiltersForPrioritySupport } from "./inbox-filters";

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
    archived: true,
    created_at: "2026-08-01T00:00:00Z",
    details: null,
    ...overrides,
  };
}

function page(items: InboxItem[], nextCursor: string | null = null): ArchivedInboxPage {
  return { items, nextCursor, hasMore: nextCursor !== null };
}

describe("archivedRowsFromPages", () => {
  it("is empty for undefined pages", () => {
    expect(archivedRowsFromPages(undefined)).toEqual([]);
  });

  it("flattens pages in order", () => {
    const out = archivedRowsFromPages([
      page([row({ id: "a", issue_id: "ia", created_at: "2026-08-02T00:00:00Z" })]),
      page([row({ id: "b", issue_id: "ib", created_at: "2026-08-01T00:00:00Z" })]),
    ]);
    expect(out.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("deduplicates one issue's notifications ACROSS a page boundary", () => {
    // The load-bearing case. The same issue appears as the last row of page 1
    // and the first row of page 2; per-page dedup would keep both and the list
    // would show the issue twice. Only the newer row survives.
    const older = row({
      id: "old",
      issue_id: "shared",
      created_at: "2026-08-01T00:00:00Z",
    });
    const newer = row({
      id: "new",
      issue_id: "shared",
      created_at: "2026-08-05T00:00:00Z",
    });
    const out = archivedRowsFromPages([page([newer]), page([older])]);
    expect(out.map((i) => i.id)).toEqual(["new"]);
  });

  it("keeps the comment anchor when the newest row of a group is a later event", () => {
    // The anchor handling `groupInboxItemsByIssue` exists for: an older row in
    // the group carried the comment_id, so the surviving row must inherit it
    // or tapping through lands on the issue instead of the comment. It has to
    // keep working now that the group's rows come from two pages.
    const commentRow = row({
      id: "c",
      issue_id: "shared",
      type: "mentioned",
      created_at: "2026-08-01T00:00:00Z",
      details: { comment_id: "cmt-9" },
    });
    const statusRow = row({
      id: "s",
      issue_id: "shared",
      type: "status_changed",
      created_at: "2026-08-05T00:00:00Z",
      details: { from: "todo", to: "done" },
    });
    const out = archivedRowsFromPages([page([statusRow]), page([commentRow])]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("s");
    expect(out[0].details?.comment_id).toBe("cmt-9");
  });

  it("does not merge rows that have no issue — they group on their own id", () => {
    // Issue-less notifications (autopilot notices, failed quick-creates) each
    // stand alone; two of them must stay two rows.
    const out = archivedRowsFromPages([
      page([
        row({ id: "n1", issue_id: null, created_at: "2026-08-02T00:00:00Z" }),
        row({ id: "n2", issue_id: null, created_at: "2026-08-01T00:00:00Z" }),
      ]),
    ]);
    expect(out.map((i) => i.id)).toEqual(["n1", "n2"]);
  });

  it("sorts the merged result newest-first even when pages arrive out of order", () => {
    const out = archivedRowsFromPages([
      page([row({ id: "older", issue_id: "ia", created_at: "2026-08-01T00:00:00Z" })]),
      page([row({ id: "newer", issue_id: "ib", created_at: "2026-08-09T00:00:00Z" })]),
    ]);
    expect(out.map((i) => i.id)).toEqual(["newer", "older"]);
  });
});

describe("archivedInboxTotal", () => {
  it("is zero without facets, so the entry row hides rather than printing a guess", () => {
    expect(archivedInboxTotal(undefined)).toBe(0);
  });

  it("sums the ACTOR dimension", () => {
    // Status and priority are properties of the linked issue, so an issue-less
    // notification is absent from both — measured against the live server, each
    // of those comes up 6 short of the real 910. Every row has an actor, so the
    // actor dimension is the only one that partitions the whole archive.
    expect(
      archivedInboxTotal({ actors: { "agent:a": 9, system: 1 } }),
    ).toBe(10);
  });

  it("ignores the incomplete dimensions when they are all it is given shape of", () => {
    expect(archivedInboxTotal({ actors: {} })).toBe(0);
  });
});

describe("hasPagedBeyondFirst", () => {
  it("is false for a single page, so a short archive says nothing", () => {
    expect(hasPagedBeyondFirst(0)).toBe(false);
    expect(hasPagedBeyondFirst(1)).toBe(false);
  });

  it("is true once a continuation was fetched", () => {
    expect(hasPagedBeyondFirst(2)).toBe(true);
  });
});

describe("archivedEmptyReason", () => {
  it("is 'none' whenever there are rows to show", () => {
    expect(archivedEmptyReason({ visibleCount: 3, activeFilterCount: 0 })).toBe("none");
    expect(archivedEmptyReason({ visibleCount: 3, activeFilterCount: 2 })).toBe("none");
  });

  it("is 'archive' for an empty archive with no filters", () => {
    expect(archivedEmptyReason({ visibleCount: 0, activeFilterCount: 0 })).toBe("archive");
  });

  it("is 'filtered' for an empty result with filters active", () => {
    // The distinction the screen's fallback effect depends on: 'archive'
    // bounces the user back to the main inbox, 'filtered' must not — using the
    // filter would otherwise eject them from the archive.
    expect(archivedEmptyReason({ visibleCount: 0, activeFilterCount: 1 })).toBe(
      "filtered",
    );
    expect(archivedEmptyReason({ visibleCount: 0, activeFilterCount: 4 })).toBe(
      "filtered",
    );
  });
});

describe("archivedEntryCount", () => {
  it("uses the facet total when the facets answered", () => {
    expect(
      archivedEntryCount({
        facetTotal: 910,
        facetsUnavailable: false,
        legacyRowCount: undefined,
      }),
    ).toBe(910);
  });

  it("falls back to the capped list only when the facets FAILED", () => {
    // A server with no facets endpoint: the entry row must still appear rather
    // than taking the whole archive with it.
    expect(
      archivedEntryCount({
        facetTotal: 0,
        facetsUnavailable: true,
        legacyRowCount: 281,
      }),
    ).toBe(281);
  });

  it("reports zero when the facets failed and the fallback has not landed", () => {
    expect(
      archivedEntryCount({
        facetTotal: 0,
        facetsUnavailable: true,
        legacyRowCount: undefined,
      }),
    ).toBe(0);
  });

  it("treats a zero total as an answer, not as unavailability", () => {
    // Gating the fallback on `total === 0` would refetch the capped list on
    // every load of an empty archive just to re-learn it is empty.
    expect(
      archivedEntryCount({
        facetTotal: 0,
        facetsUnavailable: false,
        legacyRowCount: 281,
      }),
    ).toBe(0);
  });
});

describe("archivedCountUnavailable", () => {
  it("is false whenever the facets answered", () => {
    expect(
      archivedCountUnavailable({
        facetsUnavailable: false,
        fallbackPending: false,
        fallbackUnavailable: true,
      }),
    ).toBe(false);
  });

  it("is false while the fallback is still in flight", () => {
    // Mid-load is not failure: showing "—" here would flicker on every open.
    expect(
      archivedCountUnavailable({
        facetsUnavailable: true,
        fallbackPending: true,
        fallbackUnavailable: false,
      }),
    ).toBe(false);
  });

  it("is true only once the fallback has also failed", () => {
    expect(
      archivedCountUnavailable({
        facetsUnavailable: true,
        fallbackPending: false,
        fallbackUnavailable: true,
      }),
    ).toBe(true);
  });
});

describe("archivedPriorityFilterSupport", () => {
  /**
   * Always "supported" — and the bug that makes this worth a test rather than
   * a constant.
   *
   * Found on the device in iteration 238. The screen fetched the list with its
   * filter selection but derived the header count, the filter badge and the
   * client-side pass from a second copy run through
   * `inboxFiltersForPrioritySupport`. With `prioritySupport` probed off the
   * response and the response empty — which is what a filter matching nothing,
   * or a failed page, looks like — that helper reports "unknown" and STRIPS
   * the priority selection. On screen: a list fetched with
   * `priorities=urgent`, labelled 910, with no filter badge.
   */
  it("is supported", () => {
    expect(archivedPriorityFilterSupport()).toBe("supported");
  });

  it("does not reproduce the bug's strip when it is what feeds the capability", () => {
    // The regression, stated as the invariant that broke: the selection the
    // request uses must survive the capability decision. Probed the wrong way
    // (off an empty response) the selection is destroyed; the right answer
    // leaves it intact.
    const selection = {
      statuses: [] as const,
      priorities: ["urgent"] as const,
      actors: [] as const,
      unreadOnly: false,
    };
    expect(inboxFiltersForPrioritySupport(selection, "unknown").priorities).toEqual([]);
    expect(
      inboxFiltersForPrioritySupport(selection, archivedPriorityFilterSupport())
        .priorities,
    ).toEqual(["urgent"]);
  });
});

/**
 * Iteration 257 (MYS-2228): the archived filters' "From" section.
 *
 * The section printed `getName(...)` into the row label AND sorted on that same
 * string, so one read produced two failures at once: 「Unknown」 asserted as a
 * name, and a row ORDER that depended on which directories had answered. The
 * second is the one a warm-cache manual check never sees — on a partial cache
 * (members resolved, agents not) the read and unread rows interleave, and every
 * directory that lands reshuffles the sheet under the user's finger.
 *
 * These tests pin the split: the LABEL may be withheld, the ORDER may not move.
 */
describe("archivedActorFilterRows", () => {
  const NAMES: Record<string, string> = {
    "member:m1": "Zoe",
    "member:m2": "Ada",
    "agent:a1": "Grace",
    "agent:a2": "Lin",
  };
  const nameOf = (type: string, id: string) => NAMES[`${type}:${id}`] ?? "Unknown";

  const FACETS = {
    "member:m1": 3,
    "member:m2": 1,
    "agent:a1": 5,
    "agent:a2": 2,
    system: 4,
  };

  const COLD = { member: false, agent: false, squad: false };
  const HALF = { member: true, agent: false, squad: false };
  const WARM = { member: true, agent: true, squad: true };

  const rowsFor = (readiness: typeof COLD) =>
    archivedActorFilterRows({
      facetActors: FACETS,
      selected: [],
      readiness,
      nameOf,
      systemLabel: "From",
    });

  it("withholds every directory-derived label while nothing has settled", () => {
    const rows = rowsFor(COLD);
    // `system` is absent from the facets map? No — it is present, and it is a
    // constant rather than a read, so it must be stated from the first frame.
    const system = rows.find((r) => r.type === "system");
    expect(system?.label).toBe("From");
    // Every other row withholds — and withholds to `null`, not to a sentinel.
    for (const r of rows.filter((row) => row.type !== "system")) {
      expect(r.label, r.key).toBeNull();
    }
  });

  it("states no fallback word in any state", () => {
    // 「Unknown」 is the claim, whatever the spelling. A row that cannot name
    // its actor says nothing; it never says a placeholder.
    for (const readiness of [COLD, HALF, WARM]) {
      for (const r of rowsFor(readiness)) {
        expect(r.label ?? "", r.key).not.toMatch(/Unknown|Squad$/);
      }
    }
  });

  it("orders the rows identically in the cold, half-read and warm snapshots", () => {
    // THE assertion of this round. Readiness may change the text; it may not
    // change the sequence.
    const keys = (readiness: typeof COLD) => rowsFor(readiness).map((r) => r.key);
    expect(keys(HALF)).toEqual(keys(COLD));
    expect(keys(WARM)).toEqual(keys(COLD));
  });

  it("keeps the order stable on the composite key, not on the names", () => {
    // Proves the previous test is not vacuous: sorting by the resolved names
    // would give a DIFFERENT order (Ada < Grace < Lin < Zoe < From), so a
    // regression to label-sorting fails here rather than passing by accident.
    const warm = rowsFor(WARM);
    const byLabel = [...warm]
      .sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""))
      .map((r) => r.key);
    expect(byLabel).not.toEqual(warm.map((r) => r.key));
    // …and the actual order is the key order.
    expect(warm.map((r) => r.key)).toEqual(
      [...warm.map((r) => r.key)].sort((a, b) => a.localeCompare(b)),
    );
  });

  it("names every actor once its own directory has answered, per TYPE", () => {
    // The half-read snapshot: members resolved, agents not. A gate on BOTH
    // directories would blank the member names too — the per-type regression
    // iterations 253/254 exist to prevent.
    const rows = rowsFor(HALF);
    expect(rows.find((r) => r.key === "member:m1")?.label).toBe("Zoe");
    expect(rows.find((r) => r.key === "member:m2")?.label).toBe("Ada");
    expect(rows.find((r) => r.key === "agent:a1")?.label).toBeNull();
    expect(rows.find((r) => r.key === "agent:a2")?.label).toBeNull();
  });

  it("keeps a selected actor in the list even when the facets no longer count it", () => {
    // The checkbox has to stay reachable to be switched off, so the union with
    // the current selection is load-bearing — and an unread row must still be
    // present, just unnamed.
    const rows = archivedActorFilterRows({
      facetActors: {},
      selected: ["agent:a1"],
      readiness: COLD,
      nameOf,
      systemLabel: "From",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "agent:a1", label: null, count: 0 });
  });

  it("carries the facet count unchanged — a count is not a directory read", () => {
    const cold = rowsFor(COLD);
    const warm = rowsFor(WARM);
    expect(cold.map((r) => r.count)).toEqual(warm.map((r) => r.count));
    expect(cold.find((r) => r.key === "agent:a1")?.count).toBe(5);
  });

  it("renders the settled-but-gone actor as its id fragment", () => {
    // A directory that answered and does not hold the row is a MEASUREMENT, so
    // the row names which actor is gone rather than drawing a load mark.
    const rows = archivedActorFilterRows({
      facetActors: { "agent:ghost": 1 },
      selected: [],
      readiness: WARM,
      nameOf: () => "Unknown Agent",
      systemLabel: "From",
    });
    expect(rows[0].label).toBe("ghost");
  });
});
