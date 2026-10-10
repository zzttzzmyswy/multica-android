import { describe, expect, it } from "vitest";
import { needRunConfirm } from "./batch-issues";
import {
  MAX_HANDOFF_NOTE,
  assignConfirmPayload,
  createRunHintKey,
  createRunHintKind,
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
