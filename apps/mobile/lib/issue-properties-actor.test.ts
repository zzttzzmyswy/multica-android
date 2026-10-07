/**
 * Iteration 207 — `actor` / `multi_actor` value handling on the mobile side.
 *
 * `packages/core/types/property.actor.test.ts` pins the encoding helpers. This
 * suite pins how a phone renders the two types, which is where mobile diverges
 * from web:
 *
 *   - `formatPropertyValue` has no actor branch, so a `member:<uuid>` value
 *     falls into `default:` and reaches the UI as the raw reference string.
 *     The user sees `member:0f8e…` where web shows the member's avatar + name.
 *   - `issueMatchesPropertyFilters` compares raw values against the selected
 *     ids. An actor filter chip carries `member:<uuid>`, so containment works
 *     by accident today — but only because nobody strips the prefix. Pinned
 *     here so a future "normalize the value" change cannot silently break it.
 *   - `propertyTypeIcon` / `propertyTypeLabelKey` fall through to the unknown
 *     cube for both types.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

import type { Issue, IssueProperty } from "@multica/core/types";
import {
  formatPropertyValue,
  propertyTypeIcon,
  propertyTypeLabelKey,
  toggleActorRefValue,
} from "./issue-properties";
import {
  issueMatchesPropertyFilters,
  propertyFilterOptions,
} from "./filter-issues";

function property(overrides: Partial<IssueProperty> = {}): IssueProperty {
  return {
    id: "p1",
    workspace_id: "w1",
    name: "Reviewer",
    type: "actor",
    description: "",
    icon: "",
    config: {},
    position: 0,
    archived: false,
    usage_count: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function issue(properties: Issue["properties"]): Issue {
  return {
    id: "i1",
    workspace_id: "w1",
    number: 1,
    identifier: "MYS-1",
    title: "t",
    description: null,
    status: "todo",
    priority: "none",
    assignee_type: null,
    assignee_id: null,
    creator_type: "member",
    creator_id: "u1",
    parent_issue_id: null,
    project_id: null,
    position: 0,
    stage: null,
    start_date: null,
    due_date: null,
    metadata: {},
    properties,
    created_at: "",
    updated_at: "",
  };
}

describe("actor values resolve to member references", () => {
  it("reads a single actor value as one member ref", () => {
    const display = formatPropertyValue(
      property({ type: "actor" }),
      "member:u-abc",
    );
    expect(display).toEqual({
      kind: "actors",
      refs: [{ kind: "member", id: "u-abc" }],
    });
  });

  it("reads a multi_actor value as the list of refs, in stored order", () => {
    // The server does not canonicalize actor lists (unlike multi_select), so
    // insertion order is the order that persists. Re-sorting here would
    // reshuffle the avatar row on every edit.
    const display = formatPropertyValue(
      property({ type: "multi_actor" }),
      ["member:u-b", "member:u-a"],
    );
    expect(display).toEqual({
      kind: "actors",
      refs: [
        { kind: "member", id: "u-b" },
        { kind: "member", id: "u-a" },
      ],
    });
  });

  it("never renders the raw member: reference string", () => {
    // The defect this file exists for: `default:` stringified the value, so a
    // phone showed `member:0f8e-…` where web showed a name.
    const display = formatPropertyValue(
      property({ type: "actor" }),
      "member:0f8e1234-5678-90ab-cdef-1234567890ab",
    );
    expect(display?.kind).not.toBe("plain");
  });

  it("drops a ref whose kind this build cannot parse", () => {
    // A newer backend widening actorPropertyKinds ships e.g. "team:<uuid>".
    // Rendering it raw would show an id the user cannot interpret; the refs
    // this build understands still render.
    const display = formatPropertyValue(
      property({ type: "multi_actor" }),
      ["member:u-a", "team:t-1"],
    );
    expect(display).toEqual({
      kind: "actors",
      refs: [{ kind: "member", id: "u-a" }],
    });
  });

  it("reports a wholly-unparseable value as unavailable, not empty", () => {
    // Showing this as "empty" invites the user to fill in a field that
    // already holds a value they cannot see (web's `unknown_value`). The
    // distinction is load-bearing for the single `actor` type, where an
    // overwrite is a silent data loss.
    const display = formatPropertyValue(
      property({ type: "actor" }),
      "team:t-1",
    );
    expect(display).toEqual({ kind: "unknownActors" });
  });

  it("treats an absent or empty value as unset, never as garbage", () => {
    expect(formatPropertyValue(property({ type: "actor" }), "")).toBeNull();
    expect(formatPropertyValue(property({ type: "multi_actor" }), [])).toBeNull();
    // A truncated reference ("member:" with no id) is a value this build
    // cannot parse — same bucket as an unknown kind, not "unset".
    expect(formatPropertyValue(property({ type: "actor" }), "member:")).toEqual({
      kind: "unknownActors",
    });
    expect(
      formatPropertyValue(property({ type: "multi_actor" }), ["garbage"]),
    ).toEqual({ kind: "unknownActors" });
  });
});

describe("actor property chrome", () => {
  it("gives both actor types their own icon instead of the unknown cube", () => {
    expect(propertyTypeIcon("actor")).not.toBe(propertyTypeIcon("unknown_future"));
    expect(propertyTypeIcon("multi_actor")).not.toBe(
      propertyTypeIcon("unknown_future"),
    );
  });

  it("gives both actor types a translatable label key", () => {
    expect(propertyTypeLabelKey("actor")).toBe("properties.type.actor");
    expect(propertyTypeLabelKey("multi_actor")).toBe(
      "properties.type.multi_actor",
    );
  });
});

describe("actor properties are filterable", () => {
  it("matches a member filter against a single actor value", () => {
    const filters = { p1: ["member:u-a"] };
    expect(issueMatchesPropertyFilters(issue({ p1: "member:u-a" }), filters)).toBe(
      true,
    );
    expect(issueMatchesPropertyFilters(issue({ p1: "member:u-b" }), filters)).toBe(
      false,
    );
  });

  it("matches a member filter when any entry of a multi_actor value agrees", () => {
    // The server filters actor properties by @> containment, which is
    // order-insensitive and matches any single element.
    const filters = { p1: ["member:u-b"] };
    expect(
      issueMatchesPropertyFilters(
        issue({ p1: ["member:u-a", "member:u-b"] }),
        filters,
      ),
    ).toBe(true);
    expect(
      issueMatchesPropertyFilters(issue({ p1: ["member:u-a"] }), filters),
    ).toBe(false);
  });

  it("never matches an issue with no value for the filtered definition", () => {
    expect(
      issueMatchesPropertyFilters(issue({}), { p1: ["member:u-a"] }),
    ).toBe(false);
  });
});

describe("toggling a multi_actor value", () => {
  it("adds a member, preserving insertion order", () => {
    // The server does not canonicalize actor lists, so the order the user
    // built is the order that persists — and the order the avatar row
    // re-renders in.
    expect(toggleActorRefValue(["member:u-a"], "member:u-b")).toEqual([
      "member:u-a",
      "member:u-b",
    ]);
  });

  it("removes an already-selected member", () => {
    expect(
      toggleActorRefValue(["member:u-a", "member:u-b"], "member:u-a"),
    ).toEqual(["member:u-b"]);
  });

  it("clears the property when the last member is unticked", () => {
    // `undefined` is the unset signal the mutation turns into a DELETE —
    // an empty array would be a value the server rejects outright.
    expect(toggleActorRefValue(["member:u-a"], "member:u-a")).toBeUndefined();
  });

  it("keeps unknown-kind entries when a known member is ticked", () => {
    // The data-loss guard. A newer backend widens actorPropertyKinds to e.g.
    // "team"; ticking a member must not delete the entry the user cannot see.
    expect(toggleActorRefValue(["team:t-1"], "member:u-a")).toEqual([
      "team:t-1",
      "member:u-a",
    ]);
  });

  it("keeps unknown-kind entries when a known member is unticked", () => {
    expect(
      toggleActorRefValue(["team:t-1", "member:u-a"], "member:u-a"),
    ).toEqual(["team:t-1"]);
  });

  it("refuses to grow past the server's cap instead of evicting anyone", () => {
    const full = Array.from({ length: 20 }, (_, i) => `member:u-${i}`);
    // A tick at capacity is a no-op — silently dropping another member to
    // make room would look like the picker ate a value the user chose.
    expect(toggleActorRefValue(full, "member:extra")).toEqual(full);
    // Unticking at capacity still works: the cap only blocks growth.
    expect(toggleActorRefValue(full, "member:u-0")).toHaveLength(19);
  });
});

describe("the actor filter's candidate values", () => {
  const members = [
    { user_id: "u-a", name: "Ada" },
    { user_id: "u-b", name: "Bo" },
    { user_id: "u-c", name: "Cy" },
  ];

  it("offers every member as a `member:<user_id>` reference", () => {
    // The value a filter commits has to be the string the server's `@>`
    // containment matches. A bare user id would silently match nothing.
    const options = propertyFilterOptions({
      type: "actor",
      options: [],
      members,
    });
    expect(options.map((o) => o.id)).toEqual([
      "member:u-a",
      "member:u-b",
      "member:u-c",
    ]);
    expect(options.map((o) => o.name)).toEqual(["Ada", "Bo", "Cy"]);
  });

  it("lists members for multi_actor too", () => {
    expect(
      propertyFilterOptions({ type: "multi_actor", options: [], members }),
    ).toHaveLength(3);
  });

  it("puts the signed-in user first, directory order otherwise", () => {
    // Web parity (issues-header.tsx `actorOptions`): the caller's own name is
    // the one they reach for most, and the rest keep directory order — a
    // full sort would reorder every other row for no reason.
    const options = propertyFilterOptions({
      type: "actor",
      options: [],
      members,
      currentUserId: "u-c",
    });
    expect(options.map((o) => o.id)).toEqual([
      "member:u-c",
      "member:u-a",
      "member:u-b",
    ]);
  });

  it("does not touch the select catalog for actor properties", () => {
    // An actor definition has no `config.options`; falling through to the
    // option branch would answer "this property has no options" — the exact
    // dead end the actor branch exists to remove.
    const options = propertyFilterOptions({
      type: "actor",
      options: [{ id: "o1", name: "Nope", color: "#000000" }],
      members,
    });
    expect(options.map((o) => o.id)).not.toContain("o1");
  });

  it("keeps option-id values for select and multi_select", () => {
    const options = propertyFilterOptions({
      type: "select",
      options: [{ id: "o1", name: "High", color: "#111111" }],
      members,
    });
    expect(options).toEqual([{ id: "o1", name: "High", color: "#111111" }]);
  });
});
