/**
 * Iteration 207: `actor` / `multi_actor` custom properties — the pure layer.
 *
 * The live server (v0.6.0, commit ea94c7cd5) accepts `type: "actor"` and
 * `"multi_actor"` on POST /api/properties — verified against muapi.zztweb.top,
 * whose error for an unknown type enumerates exactly
 * `text, number, select, multi_select, date, checkbox, url, actor, multi_actor`.
 * This tree's `ISSUE_PROPERTY_TYPES` predates that and stops at `url`, so an
 * actor definition reaches the app as an unknown type and every surface that
 * branches on the type falls through to its unknown-type fallback.
 *
 * These assertions pin the client half of the contract the server already
 * accepts. The stored value shape is a kind-prefixed string — `"member:<uuid>"`,
 * an array of them for `multi_actor` — chosen upstream so the existing `@>`
 * containment filter and GIN index keep working with no migration.
 *
 * Reference: `packages/core/types/property.ts` on multica-ai/multica main
 * (MUL-6286, commit 9a30c51da).
 */
import { describe, expect, it } from "vitest";
import {
  ISSUE_PROPERTY_ACTOR_KINDS,
  ISSUE_PROPERTY_TYPES,
  MAX_ISSUE_PROPERTY_ACTOR_VALUES,
  actorRefsFromValue,
  actorRefValuesFromValue,
  formatActorRef,
  hasUnknownActorRef,
  isActorPropertyType,
  isKnownPropertyType,
  parseActorRef,
} from "./property";

describe("actor property types are part of the known set", () => {
  it("lists actor and multi_actor alongside the other types", () => {
    // The server's own enumeration, verbatim. A type missing here is a type
    // the app cannot name, create, render, or filter.
    expect(ISSUE_PROPERTY_TYPES).toEqual([
      "text",
      "number",
      "select",
      "multi_select",
      "date",
      "checkbox",
      "url",
      "actor",
      "multi_actor",
    ]);
  });

  it("recognises both actor types as known", () => {
    expect(isKnownPropertyType("actor")).toBe(true);
    expect(isKnownPropertyType("multi_actor")).toBe(true);
  });

  it("distinguishes actor properties from the other reference-shaped type", () => {
    expect(isActorPropertyType("actor")).toBe(true);
    expect(isActorPropertyType("multi_actor")).toBe(true);
    // `multi_select` also holds a list of ids, but its entries are option ids
    // resolved against config.options — not member references.
    expect(isActorPropertyType("multi_select")).toBe(false);
    expect(isActorPropertyType("text")).toBe(false);
    expect(isActorPropertyType("unknown_future_type")).toBe(false);
  });
});

describe("actor reference encoding", () => {
  it("formats a member reference as kind:id", () => {
    expect(formatActorRef("member", "u-1")).toBe("member:u-1");
  });

  it("only knows the member kind", () => {
    // Agents and squads are assignable but deliberately not referenceable: a
    // passive reference must not drag in agent-visibility rules.
    expect(ISSUE_PROPERTY_ACTOR_KINDS).toEqual(["member"]);
  });

  it("parses a well-formed reference", () => {
    expect(parseActorRef("member:u-1")).toEqual({ kind: "member", id: "u-1" });
  });

  it("keeps everything after the first colon as the id", () => {
    // `indexOf`, not `split` — an id containing a colon must not lose its tail.
    expect(parseActorRef("member:a:b")).toEqual({ kind: "member", id: "a:b" });
  });

  it("rejects anything that is not a reference this build can read", () => {
    expect(parseActorRef(undefined)).toBeNull();
    expect(parseActorRef(null)).toBeNull();
    expect(parseActorRef(42)).toBeNull();
    expect(parseActorRef("")).toBeNull();
    expect(parseActorRef("member")).toBeNull();
    expect(parseActorRef(":u-1")).toBeNull();
    expect(parseActorRef("member:")).toBeNull();
    // A kind a newer backend widened to, but this build cannot render.
    expect(parseActorRef("agent:a-1")).toBeNull();
  });
});

describe("reading an actor value", () => {
  it("reads a single actor value", () => {
    expect(actorRefsFromValue("member:u-1")).toEqual([
      { kind: "member", id: "u-1" },
    ]);
  });

  it("reads a multi_actor value in stored order", () => {
    expect(actorRefsFromValue(["member:u-2", "member:u-1"])).toEqual([
      { kind: "member", id: "u-2" },
      { kind: "member", id: "u-1" },
    ]);
  });

  it("is empty for unset and for non-actor shapes", () => {
    expect(actorRefsFromValue(undefined)).toEqual([]);
    expect(actorRefsFromValue("")).toEqual([]);
    expect(actorRefsFromValue(true)).toEqual([]);
  });

  it("drops unparseable entries rather than throwing on a newer backend", () => {
    expect(actorRefsFromValue(["member:u-1", "agent:a-1"])).toEqual([
      { kind: "member", id: "u-1" },
    ]);
  });
});

describe("the raw list is what an editor must round-trip", () => {
  it("keeps unknown kinds in the raw list", () => {
    // Data-loss guard: rebuilding a multi_actor value from parsed refs would
    // silently delete every entry whose kind this build doesn't know the
    // moment the user ticks a member.
    expect(actorRefValuesFromValue(["member:u-1", "agent:a-1"])).toEqual([
      "member:u-1",
      "agent:a-1",
    ]);
  });

  it("reads a single value as a one-element raw list", () => {
    expect(actorRefValuesFromValue("member:u-1")).toEqual(["member:u-1"]);
    expect(actorRefValuesFromValue("")).toEqual([]);
    expect(actorRefValuesFromValue(undefined)).toEqual([]);
    expect(actorRefValuesFromValue(false)).toEqual([]);
  });

  it("flags a value the parsed reader cannot fully explain", () => {
    // Drives the read-only decision on a single `actor` field: letting the
    // user "fill in the empty field" would overwrite a value never shown.
    expect(hasUnknownActorRef("agent:a-1")).toBe(true);
    expect(hasUnknownActorRef(["member:u-1", "agent:a-1"])).toBe(true);
    expect(hasUnknownActorRef("member:u-1")).toBe(false);
    expect(hasUnknownActorRef(["member:u-1"])).toBe(false);
    expect(hasUnknownActorRef(undefined)).toBe(false);
  });
});

describe("the multi_actor cap matches the server", () => {
  it("is 20", () => {
    expect(MAX_ISSUE_PROPERTY_ACTOR_VALUES).toBe(20);
  });
});
