/**
 * Pins for the recipient-routing rules (iteration 298).
 *
 * Every case here is a decision the server acts on: `steer` joins a live
 * turn, `restart` stops one, `skip` suppresses a trigger. Getting one wrong
 * either loses the user's message into the wrong run or kills work they did
 * not ask to kill — so the rules are asserted, not re-derived in a component.
 */
import { describe, expect, it } from "vitest";
import type { AgentTask } from "@multica/core/types";
import {
  TASK_SUPPLEMENT_CAPABILITY,
  agentRunState,
  attachmentsBlockSteer,
  isActiveTask,
  isSteerableTask,
  pruneRecipientChoices,
  recipientActions,
  recipientRouting,
  resolveRecipientAction,
  type AgentRunState,
} from "./recipient-routing";

function task(over: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "task-1",
    agent_id: "agent-1",
    issue_id: "issue-1",
    runtime_id: "runtime-1",
    status: "running",
    priority: 0,
    dispatched_at: null,
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
    created_at: "2026-11-19T00:00:00Z",
    ...over,
  } as AgentTask;
}

const ALL = { canSteer: true, canRestart: true, steerByDefault: true };

describe("isActiveTask", () => {
  it("counts a parked retry as active, and terminal runs as not", () => {
    // `deferred` has not run yet, so a message CAN still join it. Web's
    // ACTIVE_STATUSES includes it for the same reason.
    expect(isActiveTask(task({ status: "deferred" }))).toBe(true);
    expect(isActiveTask(task({ status: "waiting_local_directory" }))).toBe(true);
    for (const status of ["completed", "failed", "cancelled"] as const) {
      expect(isActiveTask(task({ status }))).toBe(false);
    }
  });
});

describe("isSteerableTask", () => {
  it("requires the negotiated capability AND the caller's permission", () => {
    const both = task({
      supplement_capability: TASK_SUPPLEMENT_CAPABILITY,
      can_supplement: true,
    });
    expect(isSteerableTask(both)).toBe(true);
    // A capability without permission (the caller may not steer this run).
    expect(
      isSteerableTask(
        task({ supplement_capability: TASK_SUPPLEMENT_CAPABILITY, can_supplement: false }),
      ),
    ).toBe(false);
    // A permission without the negotiated feature (older runtime / server).
    expect(isSteerableTask(task({ can_supplement: true }))).toBe(false);
    // A server that predates the fields entirely must degrade to "no", which
    // is what this build did before the feature existed.
    expect(isSteerableTask(task())).toBe(false);
    // A finished turn advertises nothing to join.
    expect(
      isSteerableTask(
        task({
          status: "completed",
          supplement_capability: TASK_SUPPLEMENT_CAPABILITY,
          can_supplement: true,
        }),
      ),
    ).toBe(false);
  });
});

describe("agentRunState", () => {
  it("prefers the running turn over a queued follow-up for the same agent", () => {
    const state = agentRunState(
      [task({ id: "next", status: "queued" }), task({ id: "now" })],
      "agent-1",
    );
    expect(state).toMatchObject({ kind: "running", task: { id: "now" } });
  });

  it("separates a starting turn from a queued one", () => {
    expect(agentRunState([task({ status: "dispatched" })], "agent-1").kind).toBe(
      "starting",
    );
    expect(
      agentRunState([task({ status: "waiting_local_directory" })], "agent-1").kind,
    ).toBe("starting");
    expect(agentRunState([task({ status: "deferred" })], "agent-1").kind).toBe(
      "queued",
    );
    expect(agentRunState([task({ status: "queued" })], "agent-1").kind).toBe("queued");
  });

  it("ignores other agents and finished runs", () => {
    expect(
      agentRunState(
        [task({ agent_id: "other" }), task({ status: "completed" })],
        "agent-1",
      ).kind,
    ).toBe("idle");
    expect(agentRunState([], "agent-1").kind).toBe("idle");
  });

  it("carries the steerable flag from the task it picked", () => {
    const state = agentRunState(
      [
        task({ id: "now", supplement_capability: TASK_SUPPLEMENT_CAPABILITY, can_supplement: true }),
      ],
      "agent-1",
    );
    expect(state).toMatchObject({ kind: "running", steerable: true });
  });
});

describe("recipientActions", () => {
  const steerable: AgentRunState = {
    kind: "running",
    task: task({ supplement_capability: TASK_SUPPLEMENT_CAPABILITY, can_supplement: true }),
    steerable: true,
  };
  const busy: AgentRunState = { kind: "running", task: task(), steerable: false };

  it("offers the full menu to a steerable running turn", () => {
    expect(recipientActions(steerable, ALL)).toEqual([
      "steer",
      "after_run",
      "restart",
      "skip",
    ]);
  });

  it("drops steer when the turn cannot take input, keeping the rest", () => {
    expect(recipientActions(busy, ALL)).toEqual(["after_run", "restart", "skip"]);
  });

  it("offers only start/skip to an idle or queued recipient", () => {
    expect(recipientActions({ kind: "idle" }, ALL)).toEqual(["start", "skip"]);
    expect(
      recipientActions({ kind: "queued", task: task({ status: "queued" }) }, ALL),
    ).toEqual(["start", "skip"]);
  });

  it("treats a starting turn like a busy one, not an idle one", () => {
    expect(
      recipientActions(
        { kind: "starting", task: task({ status: "dispatched" }) },
        ALL,
      ),
    ).toEqual(["after_run", "restart", "skip"]);
  });

  it("removes steer when the message carries files", () => {
    // A running turn takes text only; offering "steer" here would either be
    // rejected or drop the attachment into the follow-up run.
    expect(recipientActions(steerable, { ...ALL, canSteer: false })).toEqual([
      "after_run",
      "restart",
      "skip",
    ]);
  });

  it("removes restart while editing — an edit never stops a run", () => {
    expect(recipientActions(steerable, { ...ALL, canRestart: false })).toEqual([
      "steer",
      "after_run",
      "skip",
    ]);
  });
});

describe("resolveRecipientAction", () => {
  const steerable: AgentRunState = {
    kind: "running",
    task: task({ supplement_capability: TASK_SUPPLEMENT_CAPABILITY, can_supplement: true }),
    steerable: true,
  };

  it("uses the explicit choice when it is still available", () => {
    expect(resolveRecipientAction(steerable, "restart", ALL)).toBe("restart");
    expect(resolveRecipientAction(steerable, "after_run", ALL)).toBe("after_run");
    expect(resolveRecipientAction({ kind: "idle" }, "skip", ALL)).toBe("skip");
  });

  it("defaults to steer only when the composer says so", () => {
    expect(resolveRecipientAction(steerable, undefined, ALL)).toBe("steer");
    expect(
      resolveRecipientAction(steerable, undefined, { ...ALL, steerByDefault: false }),
    ).toBe("after_run");
  });

  it("drops a choice the state no longer allows", () => {
    // Files arrived after the user picked "steer".
    expect(resolveRecipientAction(steerable, "steer", { ...ALL, canSteer: false })).toBe(
      "after_run",
    );
    // The turn ended while the message was being written.
    expect(resolveRecipientAction({ kind: "idle" }, "steer", ALL)).toBe("start");
    expect(resolveRecipientAction({ kind: "idle" }, "restart", ALL)).toBe("start");
    // "restart" is gone but steering is still allowed, so the default applies
    // rather than a bare first-in-list: this is web's exact fallback order
    // (chosen → steer-by-default → first non-steer action).
    expect(
      resolveRecipientAction(steerable, "restart", { ...ALL, canRestart: false }),
    ).toBe("steer");
    // An EDIT composer forbids both, and then falls to the first safe action.
    expect(
      resolveRecipientAction(steerable, "restart", {
        canSteer: false,
        canRestart: false,
        steerByDefault: true,
      }),
    ).toBe("after_run");
  });

  it("never returns steer as the idle default", () => {
    // `actions[0]` for idle is "start"; a fallback that returned "steer"
    // would send a steer_task_ids entry with no running turn.
    expect(
      resolveRecipientAction({ kind: "idle" }, undefined, { ...ALL, steerByDefault: true }),
    ).toBe("start");
  });
});

describe("recipientRouting", () => {
  const steerable: AgentRunState = {
    kind: "running",
    task: task({ id: "turn-live", supplement_capability: TASK_SUPPLEMENT_CAPABILITY, can_supplement: true }),
    steerable: true,
  };
  const busy: AgentRunState = { kind: "running", task: task({ id: "turn-busy" }), steerable: false };

  it("splits recipients into suppress / steer / restart lists", () => {
    expect(
      recipientRouting([
        { agentId: "a", action: "steer", state: steerable },
        { agentId: "b", action: "skip", state: { kind: "idle" } },
        { agentId: "c", action: "restart", state: busy },
      ]),
    ).toEqual({
      suppressAgentIds: ["b"],
      steerTaskIds: ["turn-live"],
      restartTaskIds: ["turn-busy"],
    });
  });

  it("puts a starting or queued turn in restart, and an idle one nowhere", () => {
    expect(
      recipientRouting([
        { agentId: "a", action: "restart", state: { kind: "queued", task: task({ id: "q" }) } },
        { agentId: "b", action: "restart", state: { kind: "idle" } },
        { agentId: "c", action: "start", state: { kind: "idle" } },
      ]),
    ).toEqual({ suppressAgentIds: [], steerTaskIds: [], restartTaskIds: ["q"] });
  });

  it("never emits a steer id for a turn that is not running", () => {
    // Defensive: a choice can outlive its turn. An id here would be sent as
    // `steer_task_ids` for a run that already ended.
    expect(
      recipientRouting([
        { agentId: "a", action: "steer", state: { kind: "idle" } },
        { agentId: "b", action: "steer", state: { kind: "queued", task: task({ id: "q" }) } },
      ]).steerTaskIds,
    ).toEqual([]);
  });
});

describe("attachmentsBlockSteer", () => {
  const steerable: AgentRunState = {
    kind: "running",
    task: task({ supplement_capability: TASK_SUPPLEMENT_CAPABILITY, can_supplement: true }),
    steerable: true,
  };

  it("warns only when a file-backed message would still steer", () => {
    const recipients = [{ agentId: "a", action: "steer" as const, state: steerable }];
    expect(attachmentsBlockSteer(recipients, true, true)).toBe(true);
    expect(attachmentsBlockSteer(recipients, false, true)).toBe(false);
    // Files already forbade steering, so there is nothing to warn about.
    expect(attachmentsBlockSteer(recipients, true, false)).toBe(false);
  });

  it("stays quiet when the recipient will not steer anyway", () => {
    expect(
      attachmentsBlockSteer(
        [{ agentId: "a", action: "after_run", state: steerable }],
        true,
        true,
      ),
    ).toBe(false);
    expect(
      attachmentsBlockSteer(
        [{ agentId: "a", action: "steer", state: { kind: "idle" } }],
        true,
        true,
      ),
    ).toBe(false);
  });
});

describe("pruneRecipientChoices", () => {
  it("drops choices for recipients that are no longer in the draft", () => {
    // An @mention was edited away: its "skip" must not survive to suppress a
    // re-triggering agent the user still means to address.
    expect(pruneRecipientChoices({ a: "skip", b: "steer" }, ["b"])).toEqual({
      b: "steer",
    });
  });

  it("returns the same object when nothing changed, so effects do not loop", () => {
    const chosen: Record<string, "skip" | "steer"> = { a: "skip", b: "steer" };
    expect(pruneRecipientChoices(chosen, ["a", "b"])).toBe(chosen);
  });

  it("handles the empty cases", () => {
    expect(pruneRecipientChoices({}, ["a"])).toEqual({});
    expect(pruneRecipientChoices({ a: "skip" }, [])).toEqual({});
  });
});
