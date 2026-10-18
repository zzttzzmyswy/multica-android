import { describe, expect, it } from "vitest";
import {
  actorNameState,
  actorNameText,
  actorReadiness,
  isActorTypeResolved,
  isResolvedActorName,
  joinedActorNames,
  echoLabelOrEmpty,
  ECHO_FALLBACK_BY_TYPE,
  ECHO_UNKNOWN_NOUN,
  GONE_ID_FRAGMENT,
  selectedActorLabel,
  SYSTEM_ACTOR_NAME,
  SYSTEM_ACTOR_STATE,
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

/**
 * Iteration 255 (MYS-2219) — the two shapes that only show up once a surface
 * actually renders a resolver's output, rather than a `getName` string.
 */
describe("a system actor names a constant, not a directory row", () => {
  it("is nameable with no directory read behind it", () => {
    // Without this, wiring any surface to `resolveActorName` would blank every
    // platform notice (a child-done comment, a failed-run report): `system` is
    // not one of the three directories, so `isActorTypeResolved` answers false
    // for it forever — honest for "no read can answer", wrong for "there is
    // nothing to read because the name is a constant".
    expect(SYSTEM_ACTOR_STATE).toEqual({ kind: "name", name: "Multica" });
    expect(actorNameText(SYSTEM_ACTOR_STATE)).toBe(SYSTEM_ACTOR_NAME);
    // …and it is not a sentinel, so a downstream `isResolvedActorName` check
    // does not reject it either.
    expect(isResolvedActorName(SYSTEM_ACTOR_NAME)).toBe(true);
  });

  it("uses web's word for it", () => {
    // `packages/core/workspace/hooks.ts` `buildActorNameResolver`: system →
    // "Multica". The product's name, not a person's, so it is not translated.
    expect(SYSTEM_ACTOR_NAME).toBe("Multica");
  });
});

describe("a folded thread's author line", () => {
  const state = (
    byname: Record<string, string>,
    settled = true,
  ) =>
    (type: string | null | undefined, id: string | null | undefined) => {
      if (!settled) return { kind: "unsettled" } as const;
      const name = id ? byname[id] : undefined;
      return name
        ? ({ kind: "name", name } as const)
        : ({ kind: "gone", name: (id ?? "").slice(0, 8) } as const);
    };
  const ref = (id: string) => ({ type: "member", id });

  it("names up to the cap and counts the rest", () => {
    const resolve = state({ a: "Ada", b: "Bob", c: "Cleo" });
    expect(joinedActorNames([ref("a"), ref("b"), ref("c")], resolve, 2)).toBe(
      "Ada, Bob +1",
    );
    expect(joinedActorNames([ref("a"), ref("b")], resolve, 2)).toBe("Ada, Bob");
    expect(joinedActorNames([ref("a")], resolve, 2)).toBe("Ada");
  });

  it("de-duplicates by reference, first-seen order", () => {
    const resolve = state({ a: "Ada", b: "Bob" });
    expect(
      joinedActorNames([ref("b"), ref("a"), ref("b")], resolve, 2),
    ).toBe("Bob, Ada");
  });

  it("never leaves an empty segment between two commas", () => {
    // The measured defect: `map(actorNameText).join(", ")` over a withheld name
    // produces "Ada, , Grace". A reader takes the gap for a name they are
    // expected to know. An unsettled author contributes nothing AND takes its
    // separator with it.
    const partial = (type: string | null | undefined, id: string | null | undefined) =>
      id === "b"
        ? ({ kind: "unsettled" } as const)
        : state({ a: "Ada", c: "Grace" })(type, id);
    const line = joinedActorNames([ref("a"), ref("b"), ref("c")], partial, 2);
    expect(line).toBe("Ada, Grace");
    expect(line).not.toMatch(/,\s*,/);
    expect(line).not.toContain("Unknown");
  });

  it("counts only the authors it actually abbreviated", () => {
    // The other measured defect: `+N` was `ordered.length - MAX_NAMED`, so a
    // withheld name inflated a tail that named nobody. Three readable authors
    // with one withheld is still "Ada, Grace +1" — the tail stands for Hedy
    // alone, not for Hedy and the name nobody read.
    const partial = (type: string | null | undefined, id: string | null | undefined) =>
      id === "b"
        ? ({ kind: "unsettled" } as const)
        : state({ a: "Ada", c: "Grace", d: "Hedy" })(type, id);
    expect(joinedActorNames([ref("a"), ref("b")], partial, 2)).toBe("Ada");
    expect(
      joinedActorNames([ref("a"), ref("b"), ref("c"), ref("d")], partial, 2),
    ).toBe("Ada, Grace +1");
  });

  it("says nothing at all when no author is readable", () => {
    // Reachable on a cold start. `""` — not "+5" — is what lets the bars
    // withhold the whole clause and fall back to a sentence that names nobody.
    const line = joinedActorNames(
      [ref("a"), ref("b"), ref("c")],
      state({}, false),
      2,
    );
    expect(line).toBe("");
  });

  it("gives no tail when the tail would name nobody", () => {
    // The narrow case the two rules above leave open: some names ARE readable,
    // but every other author is withheld — so there is nothing for `+N` to
    // stand for. "Ada +2" would claim two more participants the line cannot
    // identify, which is the inflation in its smallest form.
    const half = (type: string | null | undefined, id: string | null | undefined) =>
      id === "a" ? state({ a: "Ada" })(type, id) : ({ kind: "unsettled" } as const);
    expect(
      joinedActorNames([ref("a"), ref("b"), ref("c")], half, 2),
    ).toBe("Ada");
  });

  it("identifies a genuinely-gone author by id rather than dropping them", () => {
    // A settled absence is a MEASURED participant — the directory answered and
    // does not hold them — so it fills a named slot with the id fragment the
    // rest of the primitive uses. Dropping it would undercount the thread, and
    // "+1" would point at nothing the reader can see.
    const resolve = state({ a: "Ada" });
    expect(joinedActorNames([ref("a"), ref("9999999999")], resolve, 2)).toBe(
      "Ada, 99999999",
    );
  });

  it("does not turn a withheld author into an abbreviated one", () => {
    // The distinction that makes the empty case work: `unsettled` means "not
    // known to have taken part", so it neither names nor counts. Only `gone`
    // reaches the `+N` tail.
    const half = (type: string | null | undefined, id: string | null | undefined) =>
      id === "a" ? ({ kind: "unsettled" } as const) : state({ c: "Cleo" })(type, id);
    expect(joinedActorNames([ref("a"), ref("c")], half, 2)).toBe("Cleo");
    expect(joinedActorNames([ref("a")], half, 2)).toBe("");
  });
});

/**
 * The echo context (iteration 256, MYS-2227).
 *
 * Everything above decides what an ASSERTION may say: a surface telling the
 * reader who somebody is. This block decides what an ECHO may say — a value the
 * user picked one tap ago, or that a row already holds. The two must differ in
 * exactly one branch (`unsettled`), and the difference is the whole reason this
 * module grew a context at all.
 */
describe("an echo never withholds the selection it is echoing", () => {
  const unsettled = { kind: "unsettled" } as const;
  const named = (name: string) => ({ kind: "name", name }) as const;
  const gone = (name: string) => ({ kind: "gone", name }) as const;

  it("names a resolved actor exactly as the assertion context does", () => {
    for (const type of ["member", "agent", "squad"] as const) {
      expect(
        selectedActorLabel({ state: named("Ada"), type, fallback: "…" }),
      ).toBe("Ada");
    }
  });

  it("identifies a settled-but-gone actor by its id fragment", () => {
    // The one branch both contexts share. A selection that points at a
    // deleted agent is still a selection — 「Agent」 would hide WHICH one.
    expect(
      selectedActorLabel({ state: gone("99999999"), type: "agent", fallback: "…" }),
    ).toBe("99999999");
  });

  it("falls back to a generic noun, never to nothing, while unread", () => {
    // THE contract. A skeleton or an empty string in a picker's "Assign to"
    // row reads as "your choice was lost"; any true noun is better, because it
    // occupies the line and keeps the sheet's sentence grammatical.
    //
    // With no override the type noun answers…
    for (const type of ["member", "agent", "squad"] as const) {
      expect(selectedActorLabel({ state: unsettled, type })).toBe(
        ECHO_FALLBACK_BY_TYPE[type],
      );
    }
    // …and the result is never empty, whichever path it took.
    for (const type of ["member", "agent", "squad", "plugin", null] as const) {
      expect(selectedActorLabel({ state: unsettled, type }).length).toBeGreaterThan(0);
      expect(
        selectedActorLabel({ state: unsettled, type, fallback: "Assignee" })
          .length,
      ).toBeGreaterThan(0);
    }
  });

  it("uses the caller's own word over the type noun when it supplies one", () => {
    // The caller is the only one that knows which word its surface speaks: a
    // filter chip says 「经办人」/「Assignee」 where a picker says 「智能体」/「Agent」.
    // Forcing every echo onto `ECHO_FALLBACK_BY_TYPE` would put a second
    // vocabulary beside the one the sheet the chip opens already uses.
    for (const type of ["member", "agent", "squad"] as const) {
      expect(
        selectedActorLabel({ state: unsettled, type, fallback: "Assignee" }),
      ).toBe("Assignee");
    }
  });

  it("falls back to the type noun when the caller supplies no word", () => {
    // The shared constants are the default, not a dead branch: a caller with no
    // translation layer (a store, a log line) still gets a real noun.
    for (const type of ["member", "agent", "squad"] as const) {
      expect(selectedActorLabel({ state: unsettled, type })).toBe(
        ECHO_FALLBACK_BY_TYPE[type],
      );
    }
  });

  it("uses the caller's own word when the type is unknown to this build", () => {
    // An actor kind invented after this build must not echo as "undefined".
    for (const type of ["plugin", "system", null, undefined]) {
      expect(
        selectedActorLabel({ state: unsettled, type, fallback: "Choose" }),
      ).toBe("Choose");
    }
    // …and with no word either, a generic mark — still not "undefined".
    for (const type of ["plugin", null, undefined]) {
      expect(selectedActorLabel({ state: unsettled, type })).toBe(
        ECHO_UNKNOWN_NOUN,
      );
    }
  });

  it("keeps an unset field's own label rather than inventing a type", () => {
    // 「Unassigned」 is a measurement of the ROW's field (assignee_id is null),
    // not of a directory — so it survives even before any read answers. This is
    // the same call `table-view.tsx`'s assignee cell already makes with
    // `empty={empty}`.
    expect(
      echoLabelOrEmpty({
        state: unsettled,
        type: null,
        empty: true,
        emptyLabel: "Unassigned",
        fallback: "…",
      }),
    ).toBe("Unassigned");
  });

  it("still echoes a selection through echoLabelOrEmpty when there is one", () => {
    expect(
      echoLabelOrEmpty({
        state: named("Ada"),
        type: "member",
        empty: false,
        emptyLabel: "Unassigned",
        fallback: "…",
      }),
    ).toBe("Ada");
    // Set-but-unread keeps a noun (the caller's, when it has one) and never
    // borrows the EMPTY label — that distinction is the whole reason
    // `echoLabelOrEmpty` takes both.
    expect(
      echoLabelOrEmpty({
        state: unsettled,
        type: "member",
        empty: false,
        emptyLabel: "Unassigned",
      }),
    ).toBe("Member");
    expect(
      echoLabelOrEmpty({
        state: unsettled,
        type: "member",
        empty: false,
        emptyLabel: "Unassigned",
        fallback: "Assignee",
      }),
    ).toBe("Assignee");
  });
});
