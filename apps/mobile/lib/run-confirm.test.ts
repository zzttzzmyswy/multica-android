import { describe, expect, it } from "vitest";
import { MIN_HANDOFF_CLI_VERSION } from "@multica/core/runtimes";
import { needRunConfirm } from "./batch-issues";
import {
  MAX_HANDOFF_NOTE,
  assignConfirmPayload,
  createRunHintKey,
  createRunHintKind,
  handoffNoteDisabled,
  handoffVerdict,
  singleAssignNeedsRunConfirm,
} from "./run-confirm";

/**
 * Unit tests for the run-confirm decisions.
 *
 * The point of this file is the SHARING, not just the answers: the single-issue
 * assign path and the batch toolbar must agree about who needs confirming, and
 * about what the two control fields mean. Each shared rule is asserted twice —
 * once through the single-issue entry point, once against `needRunConfirm`
 * directly — so a later edit that re-implements the rule in either place turns
 * one of the two red instead of letting the surfaces drift apart again.
 */
describe("singleAssignNeedsRunConfirm", () => {
  it("confirms agent/squad on an issue that can start a run", () => {
    expect(singleAssignNeedsRunConfirm({ status: "todo" }, "agent")).toBe(true);
    expect(singleAssignNeedsRunConfirm({ status: "in_progress" }, "squad")).toBe(
      true,
    );
    expect(singleAssignNeedsRunConfirm({ status: "in_review" }, "agent")).toBe(
      true,
    );
    expect(singleAssignNeedsRunConfirm({ status: "done" }, "agent")).toBe(true);
    expect(singleAssignNeedsRunConfirm({ status: "blocked" }, "agent")).toBe(
      true,
    );
  });

  it("short-circuits a backlog issue — the parking lot never starts a run", () => {
    expect(singleAssignNeedsRunConfirm({ status: "backlog" }, "agent")).toBe(
      false,
    );
    expect(singleAssignNeedsRunConfirm({ status: "backlog" }, "squad")).toBe(
      false,
    );
  });

  it("never confirms members or clearing the assignee", () => {
    expect(singleAssignNeedsRunConfirm({ status: "todo" }, "member")).toBe(
      false,
    );
    expect(singleAssignNeedsRunConfirm({ status: "todo" }, null)).toBe(false);
    expect(singleAssignNeedsRunConfirm({ status: "todo" }, undefined)).toBe(
      false,
    );
  });

  it("agrees with the batch predicate it delegates to", () => {
    // The load-bearing assertion: one issue through this function must equal a
    // one-element selection through the batch rule, for every status. A second
    // reading of the rule in either place breaks this before it can ship.
    const statuses = [
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "done",
      "blocked",
      "cancelled",
    ] as const;
    for (const status of statuses) {
      for (const type of ["agent", "squad", "member", null] as const) {
        expect(
          singleAssignNeedsRunConfirm({ status }, type),
          `status=${status} type=${type}`,
        ).toBe(needRunConfirm([{ status } as never], type));
      }
    }
  });

  it("fails CLOSED when the issue is unknown", () => {
    // A sub-issue edited from its parent's row list has never populated the
    // detail cache, so "no issue" is a real state at the call site. Asking
    // costs a dismissable tap; not asking starts a run the user never agreed
    // to. The asymmetry is why unknown confirms rather than skipping.
    expect(singleAssignNeedsRunConfirm(null, "agent")).toBe(true);
    expect(singleAssignNeedsRunConfirm(undefined, "squad")).toBe(true);
    // …but an unknown issue still cannot conjure a confirmation for a write
    // that can never start a run.
    expect(singleAssignNeedsRunConfirm(null, "member")).toBe(false);
    expect(singleAssignNeedsRunConfirm(null, null)).toBe(false);
  });
});

describe("assignConfirmPayload", () => {
  const target = { type: "agent" as const, id: "a-1" };

  it("carries the assignee on both paths", () => {
    for (const suppress of [true, false]) {
      const payload = assignConfirmPayload(target, suppress, "");
      expect(payload.assignee_type).toBe("agent");
      expect(payload.assignee_id).toBe("a-1");
    }
  });

  it("the confirm path sends the note and never suppress_run", () => {
    const payload = assignConfirmPayload(target, false, "scope: parser only");
    expect(payload.handoff_note).toBe("scope: parser only");
    expect(payload.suppress_run).toBeUndefined();
    expect("suppress_run" in payload).toBe(false);
  });

  it('"Don\'t start yet" sends suppress_run and NEVER the note', () => {
    // The two fields are mutually exclusive, and this is the direction that
    // matters: a note attached to a run the user just suppressed would be
    // rendered into the opening prompt of a run that must not exist.
    const payload = assignConfirmPayload(target, true, "scope: parser only");
    expect(payload.suppress_run).toBe(true);
    expect(payload.handoff_note).toBeUndefined();
    expect("handoff_note" in payload).toBe(false);
  });

  it("omits a blank or whitespace-only note rather than sending an empty string", () => {
    // The server renders the field into the run's opening prompt; `""` would
    // add an empty handoff section to it.
    for (const note of ["", "   ", "\n\t "]) {
      const payload = assignConfirmPayload(target, false, note);
      expect("handoff_note" in payload).toBe(false);
    }
  });

  it("trims the note", () => {
    expect(assignConfirmPayload(target, false, "  padded  ").handoff_note).toBe(
      "padded",
    );
  });

  it("caps the note at the web contract of 2000 characters", () => {
    const payload = assignConfirmPayload(target, false, "x".repeat(5000));
    expect(payload.handoff_note).toHaveLength(MAX_HANDOFF_NOTE);
    expect(MAX_HANDOFF_NOTE).toBe(2000);
  });

  it("carries a squad target through unchanged", () => {
    const payload = assignConfirmPayload(
      { type: "squad", id: "s-9" },
      false,
      "note",
    );
    expect(payload.assignee_type).toBe("squad");
    expect(payload.assignee_id).toBe("s-9");
  });
});

describe("createRunHintKind", () => {
  const base = {
    assigneeType: "agent" as const,
    assigneeId: "a-1",
    isLoading: false,
    willStart: true,
  };

  it("stays hidden until an agent-like assignee is picked", () => {
    for (const type of ["member", null, undefined] as const) {
      expect(
        createRunHintKind({ ...base, assigneeType: type }),
      ).toBe("hidden");
    }
    expect(createRunHintKind({ ...base, assigneeId: null })).toBe("hidden");
    expect(createRunHintKind({ ...base, assigneeId: "" })).toBe("hidden");
  });

  it("stays hidden while the predicate has not answered", () => {
    // The whole reason this is three-way rather than a boolean: revealing the
    // parked line first and flipping it to "will start" is a verdict the user
    // reads and then has to unread.
    expect(createRunHintKind({ ...base, isLoading: true })).toBe("hidden");
  });

  it("distinguishes will-start from parked once resolved", () => {
    expect(createRunHintKind({ ...base, willStart: true })).toBe("willStart");
    expect(createRunHintKind({ ...base, willStart: false })).toBe("parked");
  });

  it("takes the verdict from the server, never from the status", () => {
    // There is deliberately no `status` parameter: the server's predicate is
    // already the authority, and a local "backlog → parked" reading here would
    // be a second implementation of the rule this caption exists to stop
    // guessing at. A parked verdict with a non-backlog status therefore stays
    // parked, because that is what the server said.
    expect(createRunHintKind.length).toBe(1);
    expect(createRunHintKind({ ...base, willStart: false })).toBe("parked");
    expect(createRunHintKind({ ...base, willStart: true })).toBe("willStart");
  });

  it("treats a squad as agent-like", () => {
    expect(
      createRunHintKind({ ...base, assigneeType: "squad" }),
    ).toBe("willStart");
  });
});

describe("createRunHintKey", () => {
  it("resolves nothing for the hidden state", () => {
    expect(createRunHintKey("hidden", "agent")).toBeNull();
  });

  it("gives a squad its own sentence — a squad delegates, it does not work", () => {
    expect(createRunHintKey("willStart", "squad")).toBe(
      "runConfirm.createWillStartSquad",
    );
    expect(createRunHintKey("willStart", "agent")).toBe(
      "runConfirm.createWillStart",
    );
  });

  it("uses the same parked line whoever it is parked for", () => {
    expect(createRunHintKey("parked", "squad")).toBe(
      "runConfirm.createParked",
    );
    expect(createRunHintKey("parked", "agent")).toBe("runConfirm.createParked");
  });
});

/**
 * The handoff NOTE gate — web `RunConfirmModal`'s `localHandoff` /
 * `noteDisabled` (`packages/views/modals/run-confirm.tsx:100-131`).
 *
 * The assignment confirmation can carry a note, but only daemons at or above
 * `MIN_HANDOFF_CLI_VERSION` render it into the run's opening prompt. Below that
 * the daemon silently drops it: the user writes a sentence, believes they said
 * something, and the agent never sees it. Web grays the box out and says so.
 *
 * The whole design turns on ONE asymmetry, asserted below from both sides:
 * a confident `false` may disable the box, but "cannot tell" (`null`) must NOT
 * — a spurious "they won't read this" is worse than a note an old daemon drops.
 * The tests therefore assert the `null` cases individually rather than trusting
 * a single happy-path check, because collapsing `null` into the disabled state
 * is exactly the mutation a careless refactor produces.
 */
describe("handoffVerdict", () => {
  const newer = MIN_HANDOFF_CLI_VERSION; // exactly at the floor → supported
  const older = "0.3.27"; // one patch below the floor → not supported

  const runtimes = [
    { id: "rt-new", metadata: { cli_version: "0.6.1" } },
    { id: "rt-floor", metadata: { cli_version: newer } },
    { id: "rt-old", metadata: { cli_version: older } },
    { id: "rt-noversion", metadata: {} },
    { id: "rt-bare", metadata: null },
    // Present but unparsable — a distinct degrade path from "absent": this one
    // gets past the empty-string check and dies in the parser.
    { id: "rt-garbage", metadata: { cli_version: "not-a-version" } },
    // A non-string value in a loosely-typed metadata bag (defensive: the bag is
    // `Record<string, unknown>` off the wire).
    { id: "rt-nonstring", metadata: { cli_version: 6 } },
  ];
  const agents = [
    { id: "a-new", runtime_id: "rt-new" },
    { id: "a-floor", runtime_id: "rt-floor" },
    { id: "a-old", runtime_id: "rt-old" },
    { id: "a-noversion", runtime_id: "rt-noversion" },
    { id: "a-bare", runtime_id: "rt-bare" },
    { id: "a-garbage", runtime_id: "rt-garbage" },
    { id: "a-nonstring", runtime_id: "rt-nonstring" },
    { id: "a-noruntime", runtime_id: null },
  ];
  const squads = [
    { id: "s-new", leader_id: "a-new" },
    { id: "s-old", leader_id: "a-old" },
    { id: "s-noleader", leader_id: null },
  ];

  const verdict = (
    assigneeType: "agent" | "squad" | "member" | null,
    assigneeId: string | null,
  ) =>
    handoffVerdict({
      assigneeType,
      assigneeId,
      agents,
      runtimes,
      squads,
    });

  it("says yes for an agent whose runtime is new enough", () => {
    expect(verdict("agent", "a-new")).toBe(true);
    expect(verdict("agent", "a-floor")).toBe(true);
  });

  it("says NO for an agent whose runtime is below the floor", () => {
    // The one case that may gray the box.
    expect(verdict("agent", "a-old")).toBe(false);
  });

  it("follows the SQUAD LEADER, not the squad — the leader runs the issue", () => {
    // A squad's run is executed by its leader, so the leader's runtime is what
    // has to render the note. Reading the squad id as an agent id would resolve
    // nothing and silently degrade every squad to "cannot tell".
    expect(verdict("squad", "s-new")).toBe(true);
    expect(verdict("squad", "s-old")).toBe(false);
  });

  it("degrades to 'cannot tell' — never to 'disabled' — on missing data", () => {
    // Every one of these is a real first-frame state: the dialog opens before
    // the agent/runtime lists have landed. Disabling the box here would break
    // the feature for everyone on every open.
    expect(verdict("agent", "a-not-loaded")).toBeNull(); // agent not in list
    expect(verdict("agent", "a-noruntime")).toBeNull(); // agent has no runtime
    expect(verdict("agent", "a-rtmissing")).toBeNull(); // runtime not in list
    expect(verdict(null, "a-new")).toBeNull(); // no assignee type
    expect(verdict("agent", null)).toBeNull(); // no assignee id
    expect(verdict("member", "m-1")).toBeNull(); // members never run
    expect(verdict("squad", "s-noleader")).toBeNull(); // squad without a leader
    expect(verdict("squad", "s-not-loaded")).toBeNull(); // squad not in list
  });

  it("treats a runtime with no parsable version as too old, like web", () => {
    // Distinct from the `null` cases above: the runtime IS bound and IS in the
    // cache, it just reports no usable `cli_version`. That is a definite answer
    // — `handoffSupported` fails closed and the server's `agent.HandoffSupported`
    // agrees by construction — so this one legitimately disables the box.
    //
    // Three separate routes into that answer, and the third is the one that
    // matters: an ABSENT version is caught by the empty-string check, but a
    // present-yet-UNPARSABLE one has to survive the parser and still fail
    // closed. A mutation that flips only the parser's fallback leaves the first
    // two green, so both are pinned here.
    expect(verdict("agent", "a-noversion")).toBe(false); // metadata has no key
    expect(verdict("agent", "a-bare")).toBe(false); // metadata is null
    expect(verdict("agent", "a-garbage")).toBe(false); // "not-a-version"
    expect(verdict("agent", "a-nonstring")).toBe(false); // number, not string
  });
});

describe("handoffNoteDisabled", () => {
  it("disables ONLY on a positive false", () => {
    expect(handoffNoteDisabled(false)).toBe(true);
    expect(handoffNoteDisabled(true)).toBe(false);
    // The soft-gate asymmetry, asserted directly: unknown must not disable.
    expect(handoffNoteDisabled(null)).toBe(false);
  });
});

describe("assignConfirmPayload with a disabled note", () => {
  const target = { type: "squad" as const, id: "s-9" };

  it("drops the note when the runtime cannot read it", () => {
    // Graying the input is not enough: the text the user already typed is still
    // in state, so the write path has to refuse it too.
    const payload = assignConfirmPayload(target, false, "scope: parser only", true);
    expect("handoff_note" in payload).toBe(false);
    // …and the assignment still goes through — this is a SOFT gate.
    expect(payload.assignee_type).toBe("squad");
    expect(payload.assignee_id).toBe("s-9");
  });

  it("still sends the note when it is readable", () => {
    expect(
      assignConfirmPayload(target, false, "scope: parser only", false).handoff_note,
    ).toBe("scope: parser only");
  });

  it("defaults to sending the note, so existing callers are unchanged", () => {
    expect(assignConfirmPayload(target, false, "note").handoff_note).toBe("note");
  });
});
