/**
 * The archived view's filter layer. Exercised directly because everything the
 * screen decides about filtering goes through these functions, and the two
 * things most likely to be got wrong are both invisible on a happy-path
 * screenshot:
 *
 *   - the *cache key* identity, which decides whether toggling a second filter
 *     box refetches or reuses (unsorted values would make one selection two
 *     keys);
 *   - the *server/client agreement* about what a filter means, which decides
 *     whether the rows on screen are the rows the count promised.
 */
import { describe, expect, it } from "vitest";
import type { InboxItem } from "@multica/core/types";
import {
  EMPTY_INBOX_FILTERS,
  filterInboxItems,
  inboxActorKey,
  inboxActorKeyParts,
  inboxFilterCount,
  inboxFiltersForPrioritySupport,
  inboxPriorityFilterSupport,
  isEmptyInboxFilters,
  normalizeInboxFilters,
  showsPriorityFilter,
  useInboxFilterStore,
  type InboxFilters,
} from "./inbox-filters";

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

function filters(overrides: Partial<InboxFilters> = {}): InboxFilters {
  return { ...EMPTY_INBOX_FILTERS, ...overrides };
}

describe("normalizeInboxFilters", () => {
  it("sorts every multi-value dimension", () => {
    const normalized = normalizeInboxFilters(
      filters({
        statuses: ["todo", "done", "blocked"],
        priorities: ["low", "urgent"],
        actors: ["agent:b", "member:a"],
      }),
    );
    expect(normalized.statuses).toEqual(["blocked", "done", "todo"]);
    expect(normalized.priorities).toEqual(["low", "urgent"]);
    expect(normalized.actors).toEqual(["agent:b", "member:a"]);
  });

  it("gives one identity to one selection regardless of click order", () => {
    // The whole reason the sort exists: the query key is built from this, so
    // these two must be indistinguishable. If they were not, selecting a
    // second priority would look like a new query — two cache entries, two
    // requests, and a spinner — for a selection that returns identical rows.
    const a = normalizeInboxFilters(filters({ priorities: ["urgent", "high"] }));
    const b = normalizeInboxFilters(filters({ priorities: ["high", "urgent"] }));
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("does not mutate the input", () => {
    const input = filters({ statuses: ["todo", "done"] });
    normalizeInboxFilters(input);
    expect(input.statuses).toEqual(["todo", "done"]);
  });
});

describe("inboxFilterCount / isEmptyInboxFilters", () => {
  it("counts selections, not dimensions, and treats unread as one", () => {
    expect(inboxFilterCount(EMPTY_INBOX_FILTERS)).toBe(0);
    expect(isEmptyInboxFilters(EMPTY_INBOX_FILTERS)).toBe(true);
    expect(
      inboxFilterCount(filters({ statuses: ["todo", "done"], unreadOnly: true })),
    ).toBe(3);
    expect(isEmptyInboxFilters(filters({ unreadOnly: true }))).toBe(false);
  });
});

describe("inboxActorKey", () => {
  it("keys members and agents on type + id", () => {
    expect(inboxActorKey(row({ actor_type: "agent", actor_id: "a1" }))).toBe(
      "agent:a1",
    );
    expect(inboxActorKey(row({ actor_type: "member", actor_id: "m1" }))).toBe(
      "member:m1",
    );
  });

  it("collapses every system notification into one bucket", () => {
    // `system` actors carry an invalid uuid that serializes to null, so there
    // is no id to key on. Keying on the type alone is what lets the facet
    // return a single "system" count rather than 910 anonymous ones.
    expect(inboxActorKey(row({ actor_type: "system", actor_id: null }))).toBe(
      "system",
    );
    expect(inboxActorKey(row({ actor_type: "system", actor_id: "junk" }))).toBe(
      "system",
    );
  });

  it("returns null when there is nothing to attribute, so the row can never match", () => {
    expect(inboxActorKey(row({ actor_type: null, actor_id: null }))).toBeNull();
    expect(inboxActorKey(row({ actor_type: "agent", actor_id: null }))).toBeNull();
  });

  it("round-trips through inboxActorKeyParts", () => {
    for (const key of ["agent:a1", "member:m1", "system"]) {
      const { type, id } = inboxActorKeyParts(key);
      if (key === "system") {
        expect(type).toBe("system");
        expect(id).toBe("");
      } else {
        expect(`${type}:${id}`).toBe(key);
      }
    }
  });

  it("keeps an id containing a colon intact", () => {
    // The separator is the FIRST colon; splitting on all of them would
    // truncate an actor id that itself contains one.
    expect(inboxActorKeyParts("agent:a:b")).toEqual({ type: "agent", id: "a:b" });
  });
});

describe("filterInboxItems", () => {
  it("returns the input untouched when nothing is selected", () => {
    const items = [row()];
    expect(filterInboxItems(items, EMPTY_INBOX_FILTERS)).toBe(items);
  });

  it("ORs within a dimension", () => {
    const items = [
      row({ id: "1", issue_status: "done" }),
      row({ id: "2", issue_status: "todo" }),
      row({ id: "3", issue_status: "blocked" }),
    ];
    const out = filterInboxItems(items, filters({ statuses: ["done", "todo"] }));
    expect(out.map((i) => i.id)).toEqual(["1", "2"]);
  });

  it("ANDs between dimensions", () => {
    const items = [
      row({ id: "1", issue_status: "done", issue_priority: "urgent" }),
      row({ id: "2", issue_status: "done", issue_priority: "low" }),
      row({ id: "3", issue_status: "todo", issue_priority: "urgent" }),
    ];
    const out = filterInboxItems(
      items,
      filters({ statuses: ["done"], priorities: ["urgent"] }),
    );
    expect(out.map((i) => i.id)).toEqual(["1"]);
  });

  it("excludes a row whose dimension value is null rather than passing it through", () => {
    // An issue-less notification has no status and no priority. Passing it
    // through "because it has no value to disagree with" would put a row on
    // screen that the count never included — the count comes from the same
    // server-side predicate.
    const items = [
      row({ id: "1", issue_status: null, issue_priority: null }),
      row({ id: "2", issue_status: "done", issue_priority: "high" }),
    ];
    expect(
      filterInboxItems(items, filters({ statuses: ["done"] })).map((i) => i.id),
    ).toEqual(["2"]);
    expect(
      filterInboxItems(items, filters({ priorities: ["high"] })).map((i) => i.id),
    ).toEqual(["2"]);
  });

  it("matches unreadOnly on the rendered row's read flag", () => {
    const items = [row({ id: "1", read: false }), row({ id: "2", read: true })];
    expect(
      filterInboxItems(items, filters({ unreadOnly: true })).map((i) => i.id),
    ).toEqual(["1"]);
  });

  it("matches an actor selection on the row's own actor, not a sibling's", () => {
    // Dedup keeps a group's newest row, and that row shows ITS actor. Matching
    // an actor from an older row of the same group would answer "issues Alice
    // ever touched" while the list displays Bob.
    const items = [
      row({ id: "1", actor_type: "agent", actor_id: "a1" }),
      row({ id: "2", actor_type: "member", actor_id: "m1" }),
    ];
    expect(
      filterInboxItems(items, filters({ actors: ["agent:a1"] })).map((i) => i.id),
    ).toEqual(["1"]);
  });

  it("matches a system selection", () => {
    const items = [
      row({ id: "1", actor_type: "system", actor_id: null }),
      row({ id: "2", actor_type: "agent", actor_id: "a1" }),
    ];
    expect(
      filterInboxItems(items, filters({ actors: ["system"] })).map((i) => i.id),
    ).toEqual(["1"]);
  });

  it("yields nothing when a selection matches nothing", () => {
    expect(
      filterInboxItems([row({ issue_status: "done" })], filters({ statuses: ["blocked"] })),
    ).toEqual([]);
  });
});

describe("inboxPriorityFilterSupport", () => {
  it("is unknown on no rows — absence of evidence, not evidence of absence", () => {
    expect(inboxPriorityFilterSupport([])).toBe("unknown");
  });

  it("is supported when every row carries a defined value, null included", () => {
    // An issue-less notification serializes `null`, not "missing". Requiring
    // only *defined* keeps a rolling deploy from reading as unsupported.
    expect(
      inboxPriorityFilterSupport([row(), row({ issue_priority: null })]),
    ).toBe("supported");
  });

  it("is unsupported as soon as one row omits the field entirely", () => {
    expect(
      inboxPriorityFilterSupport([
        row(),
        row({ issue_priority: undefined }),
      ]),
    ).toBe("unsupported");
  });
});

describe("inboxFiltersForPrioritySupport", () => {
  it("keeps a selection the backend supports", () => {
    const f = filters({ priorities: ["urgent"] });
    expect(inboxFiltersForPrioritySupport(f, "supported")).toBe(f);
  });

  it("strips a selection while support is still unknown", () => {
    // "unknown" is the empty-list case, and it strips too. This is upstream's
    // rule (packages/core/inbox/filter-store.ts) and it is the safer side of
    // the trade: an empty list is also what a status filter that matches
    // nothing looks like, so a filter that cannot be counted cannot be
    // honoured either. The selection is dormant in the store, not destroyed —
    // `filters` keeps it, only the effective copy the request uses drops it.
    const f = filters({ priorities: ["urgent"] });
    expect(inboxFiltersForPrioritySupport(f, "unknown").priorities).toEqual([]);
    expect(f.priorities).toEqual(["urgent"]);
  });

  it("strips a selection the backend cannot honour", () => {
    expect(
      inboxFiltersForPrioritySupport(filters({ priorities: ["urgent"] }), "unsupported")
        .priorities,
    ).toEqual([]);
  });

  it("does not strip other dimensions", () => {
    const f = filters({ statuses: ["done"], priorities: ["urgent"], unreadOnly: true });
    const out = inboxFiltersForPrioritySupport(f, "unsupported");
    expect(out.statuses).toEqual(["done"]);
    expect(out.unreadOnly).toBe(true);
  });
});

describe("showsPriorityFilter", () => {
  it("offers the section only when a selection would survive", () => {
    // The sheet and the stripping rule have to agree: a section whose presses
    // are then dropped is worse than no section. `unknown` strips (see above),
    // so it must not offer either.
    expect(showsPriorityFilter("supported")).toBe(true);
    expect(showsPriorityFilter("unknown")).toBe(false);
    expect(showsPriorityFilter("unsupported")).toBe(false);
  });
});

describe("useInboxFilterStore", () => {
  it("toggles a value on and back off", () => {
    const store = useInboxFilterStore.getState();
    store.toggleStatusFilter("ws-t1", "done");
    expect(useInboxFilterStore.getState().filtersByWorkspace["ws-t1"].statuses).toEqual([
      "done",
    ]);
    useInboxFilterStore.getState().toggleStatusFilter("ws-t1", "done");
    expect(useInboxFilterStore.getState().filtersByWorkspace["ws-t1"].statuses).toEqual(
      [],
    );
  });

  it("isolates one workspace's filters from another's", () => {
    useInboxFilterStore.getState().toggleStatusFilter("ws-t2a", "done");
    useInboxFilterStore.getState().toggleStatusFilter("ws-t2b", "todo");
    const state = useInboxFilterStore.getState();
    expect(state.filtersByWorkspace["ws-t2a"].statuses).toEqual(["done"]);
    expect(state.filtersByWorkspace["ws-t2b"].statuses).toEqual(["todo"]);
  });

  it("toggles unread only", () => {
    useInboxFilterStore.getState().toggleUnreadOnly("ws-t3");
    expect(useInboxFilterStore.getState().filtersByWorkspace["ws-t3"].unreadOnly).toBe(
      true,
    );
  });

  it("clearFilters drops every dimension for that workspace and leaves others alone", () => {
    const s = useInboxFilterStore.getState();
    s.toggleStatusFilter("ws-t4", "done");
    s.togglePriorityFilter("ws-t4", "urgent");
    s.toggleActorFilter("ws-t4", "agent:a1");
    s.toggleUnreadOnly("ws-t4");
    s.toggleStatusFilter("ws-t5", "todo");

    useInboxFilterStore.getState().clearFilters("ws-t4");

    expect(useInboxFilterStore.getState().filtersByWorkspace["ws-t4"]).toBeUndefined();
    expect(useInboxFilterStore.getState().filtersByWorkspace["ws-t5"].statuses).toEqual([
      "todo",
    ]);
  });

  it("clearing an untouched workspace is a no-op", () => {
    const before = useInboxFilterStore.getState().filtersByWorkspace;
    useInboxFilterStore.getState().clearFilters("ws-never-touched");
    expect(useInboxFilterStore.getState().filtersByWorkspace).toBe(before);
  });
});
