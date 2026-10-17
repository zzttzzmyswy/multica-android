import { describe, expect, it } from "vitest";
import {
  actorNameState,
  actorNameText,
  actorReadiness,
  isActorTypeResolved,
  isResolvedActorName,
  GONE_ID_FRAGMENT,
  UNRESOLVED_ACTOR_NAMES,
  type ActorReadiness,
} from "./actor-name-state";

/**
 * The shared "name, or not yet" decision (iteration 254, MYS-2215).
 *
 * `data/use-actor-name.ts`'s `getName` returns "Unknown" / "Unknown Agent"
 * both while the directory read is in flight AND when the actor is genuinely
 * gone. The issue table's assignee and creator columns printed that fallback
 * straight onto the screen, so a cold start read as "every agent on this
 * workspace has been deleted". These are the decisions that keep the two
 * apart — the same rule `lib/catalog-state.ts` states for pickers, applied to
 * the most confident claim a row can carry: a name.
 */

const ALL_RESOLVED: ActorReadiness = { member: true, agent: true, squad: true };
const NONE_RESOLVED: ActorReadiness = {
  member: false,
  agent: false,
  squad: false,
};

describe("readiness is keyed on the actor's own directory", () => {
  it("answers per type, not for the lookup as a whole", () => {
    // The whole point: a run row only ever draws agents, so a slow member
    // list must not blank agent names. The combined flag iteration 253 used
    // (`members && agents`) is right for the projects list's lead cell — a
    // lead is either — and wrong everywhere else.
    const readiness: ActorReadiness = {
      member: false,
      agent: true,
      squad: false,
    };
    expect(isActorTypeResolved(readiness, "agent")).toBe(true);
    expect(isActorTypeResolved(readiness, "member")).toBe(false);
    expect(isActorTypeResolved(readiness, "squad")).toBe(false);
  });

  it("never calls an unknown type resolved", () => {
    // There is no directory to trust, so there is nothing to assert. This is
    // the `system` case and any future union member this build predates.
    expect(isActorTypeResolved(ALL_RESOLVED, "system")).toBe(false);
    expect(isActorTypeResolved(ALL_RESOLVED, null)).toBe(false);
    expect(isActorTypeResolved(ALL_RESOLVED, undefined)).toBe(false);
  });

  it("reads the four catalog states the same way catalogRead does", () => {
    // `ready` and `empty` are settled — the directory answered, and "not in
    // it" is a fact. `loading` and `error` are not: a failed read tells us
    // nothing about who exists.
    expect(
      actorReadiness({ member: "ready", agent: "empty", squad: "loading" }),
    ).toEqual({ member: true, agent: true, squad: false });
    expect(
      actorReadiness({ member: "error", agent: "error", squad: "empty" }),
    ).toEqual({ member: false, agent: false, squad: true });
  });

  it("takes bare booleans too, so callers need not re-wrap them", () => {
    expect(
      actorReadiness({ member: true, agent: false, squad: true }),
    ).toEqual({ member: true, agent: false, squad: true });
  });
});

describe("the string form of the three states", () => {
  // `actorNameText` is what the comma-joined and single-<Text> call sites use.
  // Its whole job is that an unsettled reference contributes NOTHING: a list
  // that silently gains the word "Unknown" between two commas is the same
  // false claim as a whole cell full of it.
  const states = (readiness: ActorReadiness) => ({
    named: actorNameState({
      type: "member",
      id: "u1",
      name: "Ada",
      readiness,
    }),
    gone: actorNameState({
      type: "member",
      id: "1234567890",
      name: "Unknown",
      readiness,
    }),
    unsettled: actorNameState({
      type: "member",
      id: "u1",
      name: "Unknown",
      readiness: NONE_RESOLVED,
    }),
  });

  it("returns the name for both settled states", () => {
    const s = states(ALL_RESOLVED);
    expect(actorNameText(s.named)).toBe("Ada");
    expect(actorNameText(s.gone)).toBe("12345678");
  });

  it("returns an empty string while unsettled — never a placeholder", () => {
    const s = states(NONE_RESOLVED);
    expect(actorNameText(s.unsettled)).toBe("");
    expect(actorNameText(s.unsettled)).not.toBe("Unknown");
  });

  it("never invents text for a state it does not know", () => {
    // Defensive: the switch is exhaustiveness-checked at compile time, but a
    // future fourth state must not silently fall through to something visible.
    expect(actorNameText({ kind: "unsettled" })).toBe("");
  });
});

describe("what a cell may render for one actor", () => {
  it("says nothing while the actor's own directory is still loading", () => {
    // The defect, stated as an assertion: the name argument is irrelevant
    // here. A "still loading" directory must not produce `Unknown`, and it
    // must not produce a name either — there is no row to have read.
    expect(
      actorNameState({
        type: "agent",
        id: "agent-1",
        name: "Unknown Agent",
        readiness: NONE_RESOLVED,
      }),
    ).toEqual({ kind: "unsettled" });
    expect(
      actorNameState({
        type: "agent",
        id: "agent-1",
        name: "Ada",
        readiness: NONE_RESOLVED,
      }),
    ).toEqual({ kind: "unsettled" });
  });

  it("waits on the right directory, not on all of them", () => {
    // A member surface is ready the moment the member directory is, even with
    // the agent and squad reads still in flight.
    expect(
      actorNameState({
        type: "member",
        id: "user-1",
        name: "Grace Hopper",
        readiness: { member: true, agent: false, squad: false },
      }),
    ).toEqual({ kind: "name", name: "Grace Hopper" });
    // …and the converse: an agent whose own read has not landed stays
    // unsettled even though the member directory is complete.
    expect(
      actorNameState({
        type: "agent",
        id: "agent-1",
        name: "Unknown Agent",
        readiness: { member: true, agent: false, squad: true },
      }),
    ).toEqual({ kind: "unsettled" });
  });

  it("names a resolved actor once the directory answered", () => {
    expect(
      actorNameState({
        type: "squad",
        id: "squad-1",
        name: "Night Shift",
        readiness: ALL_RESOLVED,
      }),
    ).toEqual({ kind: "name", name: "Night Shift" });
  });

  it("reports a settled absence as a gone actor, identified by its id", () => {
    // Settled + not in the directory = measured absence. The cell still has
    // to identify WHICH actor is missing — web's member card and this app's
    // `lib/actor-profile.ts` both settled on the id's first 8 characters,
    // because "Unknown" leaves the reader unable to tell two gaps apart.
    expect(
      actorNameState({
        type: "member",
        id: "1234567890abcdef",
        name: "Unknown",
        readiness: ALL_RESOLVED,
      }),
    ).toEqual({ kind: "gone", name: "12345678" });
    expect(GONE_ID_FRAGMENT).toBe(8);
  });

  it("treats every fallback sentinel as gone, never as a name", () => {
    // `getName` has five ways to say "I could not resolve this"; all of them
    // mean the same thing to a cell, and none of them is a name.
    for (const sentinel of UNRESOLVED_ACTOR_NAMES) {
      expect(
        actorNameState({
          type: "agent",
          id: "abcdefghij",
          name: sentinel,
          readiness: ALL_RESOLVED,
        }),
        sentinel,
      ).toEqual({ kind: "gone", name: "abcdefgh" });
    }
    // An empty string is the same admission in a quieter form.
    expect(
      actorNameState({
        type: "agent",
        id: "abcdefghij",
        name: "",
        readiness: ALL_RESOLVED,
      }),
    ).toEqual({ kind: "gone", name: "abcdefgh" });
  });

  it("does not mistake a real name for a sentinel", () => {
    for (const name of ["Ada Lovelace", "Unknown Entity Bot", "Systems", "Squad Lead"]) {
      expect(isResolvedActorName(name), name).toBe(true);
    }
  });

  it("leaves the empty-reference case to the caller", () => {
    // An issue with no assignee is a measured absence of its OWN field, not
    // of a directory read, so it keeps its dash even during a cold start. The
    // primitive reports `unsettled` (it has nothing to name) and the surface
    // decides from there; `fallback` is how a caller that knows the reference
    // is simply absent says so.
    expect(
      actorNameState({
        type: null,
        id: null,
        name: "System",
        readiness: NONE_RESOLVED,
      }),
    ).toEqual({ kind: "unsettled" });
    expect(
      actorNameState({
        type: null,
        id: null,
        name: "System",
        readiness: NONE_RESOLVED,
        fallback: { kind: "name", name: "Multica" },
      }),
    ).toEqual({ kind: "name", name: "Multica" });
    expect(
      actorNameState({
        type: "member",
        id: null,
        name: "Unknown",
        readiness: ALL_RESOLVED,
        fallback: { kind: "absent" },
      }),
    ).toEqual({ kind: "unsettled" });
  });

  it("keeps an explicitly-absent reference unsettled, never named", () => {
    // `fallback` can only *name* something. A surface that has decided the
    // slot is empty passes `{ kind: "absent" }`, and the primitive must not
    // invent a name for it — that is how a blank assignee slot would acquire
    // a plausible-looking occupant.
    expect(
      actorNameState({
        type: "",
        id: "",
        name: "",
        readiness: ALL_RESOLVED,
        fallback: { kind: "absent" },
      }),
    ).toEqual({ kind: "unsettled" });
  });
});
