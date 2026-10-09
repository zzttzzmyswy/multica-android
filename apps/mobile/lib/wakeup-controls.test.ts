/**
 * Iteration 215 (MYS-2031) — the write half of the wakeup rule row.
 *
 * The section could already show a rule (MYS-2023). It could not act on one:
 * a phone user who saw "waiting for trigger" had no way to stop it, no way to
 * wake it now, no way to fix its prompt and no way to delete it, while web
 * hangs four mutations off every row. This module is the decision layer those
 * controls read, ported from web's `wakeup-control.tsx:55-105` — the branch
 * that chooses WHICH control a row gets, and whether it can be pressed.
 *
 * Why it is a separate pure module rather than logic inside the component:
 * the mobile vitest lane is Node-only (see `vitest.config.ts` — no RN
 * renderer), so a decision buried in JSX cannot be tested at all. It is also
 * the round's must-agree point: given the same rule JSON and the same run
 * status, web's `canDisable` / `canEnable` / `needsRearm` and this one must
 * reach the same verdict, or the two clients disagree about whether a switch
 * is live.
 *
 * Every branch below is exercised with a rule shaped like the live server's
 * (`mu.zztweb.top`) rather than an invented one.
 */
import { describe, expect, it } from "vitest";
import type { IssueWakeup } from "@multica/core/types";
import {
  WAKEUP_INSTRUCTION_MAX_BYTES,
  WAKEUP_SYSTEM_INSTRUCTION_MAX_BYTES,
  canDisableWakeup,
  canEnableWakeup,
  isConsumedWakeup,
  isExpiredWakeup,
  needsWakeupRearm,
  utf8ByteLength,
  wakeupControlState,
  wakeupInstructionErrorKey,
  wakeupSystemInstructionErrorKey,
  wakeupWriteErrorKey,
  wakeupWriteNeedsRefresh,
} from "./wakeup-controls";

/** A live event rule, trimmed to the fields the control reads. Copied from a
 *  real `GET /api/issues/:id/wakeups` row (MYS-2013 / MYS-2023 evidence). */
function rule(over: Partial<IssueWakeup> = {}): IssueWakeup {
  return {
    id: "w-1",
    issue_id: "i-1",
    agent_id: "a-1",
    agent_name: "技术负责人-贵",
    instruction: "review the PR",
    kind: "event",
    mode: "once",
    event_types: ["issue.status_changed"],
    filter_agent_id: null,
    filter_task_id: null,
    interval_seconds: null,
    cron_expression: null,
    timezone: "UTC",
    next_fire_at: null,
    enabled: true,
    revision: 1,
    disabled_at: null,
    last_task_id: null,
    last_error: null,
    ...over,
  };
}

const open = { closed: false };
const NOW = Date.parse("2026-10-09T12:00:00Z");

describe("utf8ByteLength", () => {
  it("counts ASCII one byte each", () => {
    expect(utf8ByteLength("abc")).toBe(3);
  });

  it("counts a BMP char as three bytes", () => {
    // The server's limit is bytes, not characters (`len()` in Go). A Chinese
    // prompt is 3 bytes per character, so a 4000-character prompt is 12000
    // bytes — counting characters would let the client send a body the server
    // rejects with a 400 the user cannot explain.
    expect(utf8ByteLength("任务")).toBe(6);
  });

  it("counts an astral char as four bytes", () => {
    expect(utf8ByteLength("🚀")).toBe(4);
  });

  it("counts nothing for the empty string", () => {
    expect(utf8ByteLength("")).toBe(0);
  });

  it("does not count a lone surrogate as three bytes", () => {
    // `"\\ud800"` is not a character; the encoder writes U+FFFD (3 bytes) for
    // it. Anything else would disagree with the server's byte count.
    expect(utf8ByteLength("\ud800")).toBe(3);
  });
});

describe("the four lifecycle predicates", () => {
  it("reads a rule whose run is queued but not started as disable-able", () => {
    // Web counts a QUEUED, not-yet-started run as withdrawable: the run was
    // enqueued by the rule and nothing has begun, so stopping the rule can
    // still stop it. A started run is beyond the rule's reach.
    expect(canDisableWakeup(rule({ enabled: false }), {
      status: "queued",
      startedAt: null,
    })).toBe(true);
    expect(canDisableWakeup(rule({ enabled: false }), {
      status: "queued",
      startedAt: "2026-10-09T11:00:00Z",
    })).toBe(false);
  });

  it("counts deferred-but-unstarted the same way as queued", () => {
    expect(canDisableWakeup(rule({ enabled: false }), {
      status: "deferred",
      startedAt: null,
    })).toBe(true);
  });

  it("refuses to disable a rule the platform already turned off", () => {
    expect(canDisableWakeup(
      rule({ enabled: false, disabled_at: "2026-10-09T10:00:00Z" }),
      { status: null, startedAt: null },
    )).toBe(false);
  });

  it("counts a spent one-shot as consumed", () => {
    expect(isConsumedWakeup(rule({ enabled: false, mode: "once" }))).toBe(true);
  });

  it("does not count a one-shot the user turned off before it fired", () => {
    // `disabled_at` set and no run: the wait never happened, so re-enabling is
    // a plain resume, not a rearm.
    expect(isConsumedWakeup(rule({
      enabled: false,
      mode: "once",
      disabled_at: "2026-10-09T10:00:00Z",
      last_task_id: null,
    }))).toBe(false);
  });

  it("counts a one-shot that ran and was then switched off as consumed", () => {
    expect(isConsumedWakeup(rule({
      enabled: false,
      mode: "once",
      disabled_at: "2026-10-09T10:00:00Z",
      last_task_id: "t-1",
    }))).toBe(true);
  });

  it("never counts a continuous rule as consumed", () => {
    expect(isConsumedWakeup(rule({ enabled: false, mode: "continuous" }))).toBe(false);
  });

  it("counts a time rule whose deadline has passed as expired", () => {
    expect(isExpiredWakeup(
      rule({ kind: "at", next_fire_at: "2026-10-09T11:00:00Z", enabled: false }),
      NOW,
    )).toBe(true);
  });

  it("counts a time rule with no deadline at all as expired", () => {
    expect(isExpiredWakeup(
      rule({ kind: "at", next_fire_at: null, enabled: false }),
      NOW,
    )).toBe(true);
  });

  it("does not count a future deadline as expired", () => {
    expect(isExpiredWakeup(
      rule({ kind: "at", next_fire_at: "2026-10-09T13:00:00Z", enabled: false }),
      NOW,
    )).toBe(false);
  });

  it("never counts a non-time rule as expired", () => {
    expect(isExpiredWakeup(rule({ kind: "event", enabled: false }), NOW)).toBe(false);
  });

  it("needs a rearm only for a stopped rule that is spent or expired", () => {
    expect(needsWakeupRearm(rule({ enabled: false, mode: "once" }), NOW)).toBe(true);
    expect(needsWakeupRearm(rule({
      enabled: false,
      kind: "at",
      next_fire_at: "2026-10-09T11:00:00Z",
    }), NOW)).toBe(true);
    // A continuous rule the user switched off is resumed, not rearmed.
    expect(needsWakeupRearm(rule({ enabled: false, mode: "continuous" }), NOW)).toBe(false);
    // A live rule never needs a rearm.
    expect(needsWakeupRearm(rule({ enabled: true }), NOW)).toBe(false);
  });

  it("rearms an expired time rule that was never spent", () => {
    // Isolates the EXPIRED half of the predicate. A `continuous`, already
    // `disabled_at` time rule is not consumed, so only `isExpiredWakeup` can
    // make this true — dropping that branch would leave a rule the server
    // refuses to enable ("choose a future time") showing a live switch.
    expect(needsWakeupRearm(rule({
      enabled: false,
      kind: "at",
      mode: "continuous",
      disabled_at: "2026-10-09T10:00:00Z",
      last_task_id: null,
      next_fire_at: "2026-10-09T11:00:00Z",
    }), NOW)).toBe(true);
  });

  it("does not rearm an unspent time rule whose deadline is still ahead", () => {
    // The other direction of the same branch: a rearm restarts a relative wait
    // from now, so sending one here would silently move a deadline the user
    // never asked to move.
    expect(needsWakeupRearm(rule({
      enabled: false,
      kind: "at",
      mode: "continuous",
      disabled_at: "2026-10-09T10:00:00Z",
      next_fire_at: "2026-10-09T13:00:00Z",
    }), NOW)).toBe(false);
  });

  it("refuses to enable while a one-shot's run is still active", () => {
    expect(canEnableWakeup(rule({ enabled: false }), { ...open, status: "running" })).toBe(false);
    expect(canEnableWakeup(rule({ enabled: false }), { ...open, status: "waiting_local_directory" })).toBe(false);
  });

  it("allows enabling a continuous rule while its run is active", () => {
    // The rule is not competing with its own run: a continuous rule is meant
    // to fire again, and web allows the toggle for exactly that reason.
    expect(canEnableWakeup(
      rule({ enabled: false, mode: "continuous" }),
      { ...open, status: "running" },
    )).toBe(true);
  });

  it("refuses to enable anything on a closed issue", () => {
    expect(canEnableWakeup(rule({ enabled: false }), { closed: true })).toBe(false);
  });

  it("allows enabling an idle rule on an open issue", () => {
    expect(canEnableWakeup(rule({ enabled: false }), { ...open, status: "completed" })).toBe(true);
  });
});

describe("the control a row gets", () => {
  it("gives a live rule a switch, on", () => {
    expect(wakeupControlState({ wakeup: rule(), ...open })).toMatchObject({
      kind: "switch",
      checked: true,
      disabled: false,
      blocked: null,
    });
  });

  it("gives a one-shot whose run is queued but unstarted a withdraw button", () => {
    // Web's second branch: the rule is already off, nothing has begun, and
    // the enqueued run can still be withdrawn — a switch would read as "off"
    // and hide the fact that a run is on its way.
    expect(wakeupControlState({
      wakeup: rule({ enabled: false }),
      status: "queued",
      startedAt: null,
      ...open,
    })).toMatchObject({ kind: "withdraw", checked: false, disabled: false, blocked: null });
  });

  it("gives a spent one-shot a resubscribe button", () => {
    expect(wakeupControlState({
      wakeup: rule({ enabled: false, mode: "once" }),
      ...open,
    })).toMatchObject({ kind: "resubscribe" });
  });

  it("gives an expired time rule a reschedule button, not a resubscribe one", () => {
    // Web branches on `kind === "at"` before falling through to resubscribe:
    // re-enabling a time rule needs a NEW time, and the server rejects an
    // enable with no time (`choose a future time`).
    expect(wakeupControlState({
      wakeup: rule({ enabled: false, kind: "at", next_fire_at: null }),
      now: NOW,
      ...open,
    })).toMatchObject({ kind: "reschedule" });
  });

  it("gives a switched-off continuous rule a plain switch, off", () => {
    expect(wakeupControlState({
      wakeup: rule({ enabled: false, mode: "continuous" }),
      ...open,
    })).toMatchObject({ kind: "switch", checked: false, disabled: false, blocked: null });
  });

  it("disables the switch while a write is in flight", () => {
    expect(wakeupControlState({ wakeup: rule(), pending: true, ...open })).toMatchObject({
      kind: "switch",
      disabled: true,
      blocked: "pending",
    });
  });

  it("blocks enabling on a closed issue and says so", () => {
    expect(wakeupControlState({
      wakeup: rule({ enabled: false, mode: "continuous" }),
      closed: true,
    })).toMatchObject({ disabled: true, blocked: "closed" });
  });

  it("blocks enabling while the rule's own run is still active", () => {
    expect(wakeupControlState({
      wakeup: rule({ enabled: false, mode: "once" }),
      status: "running",
      ...open,
    })).toMatchObject({ disabled: true, blocked: "active_run" });
  });

  it("leaves switch-off pressable with no revision to send", () => {
    // Disabling sends no revision, so a row whose revision could not be read
    // must still be stoppable — that is the one action a user needs most when
    // the row is already misbehaving.
    expect(wakeupControlState({
      wakeup: rule({ enabled: true, revision: undefined }),
      ...open,
    })).toMatchObject({ kind: "switch", checked: true, disabled: false, blocked: null });
  });

  it("refuses to enable without a usable revision instead of sending revision 0", () => {
    // Web sends `revision ?? 0`, which the server rejects with "revision is
    // required" — a 400 the user cannot act on. Refusing up front is honest:
    // the control is not pressable and the row says why.
    for (const revision of [undefined, 0, -1]) {
      expect(wakeupControlState({
        wakeup: rule({ enabled: false, mode: "continuous", revision }),
        ...open,
      })).toMatchObject({ disabled: true, blocked: "revision" });
    }
  });

  it("refuses to reschedule without a usable revision", () => {
    expect(wakeupControlState({
      wakeup: rule({ enabled: false, kind: "at", next_fire_at: null, revision: undefined }),
      now: NOW,
      ...open,
    })).toMatchObject({ kind: "reschedule", disabled: true, blocked: "revision", enableRevision: null });
  });

  it("reports pending ahead of every other reason", () => {
    // With a write in flight the user must not be told the issue is closed or
    // that the rule needs a refresh; the only true statement is "busy".
    expect(wakeupControlState({
      wakeup: rule({ enabled: false, mode: "once", revision: undefined }),
      closed: true,
      pending: true,
    })).toMatchObject({ disabled: true, blocked: "pending" });
  });

  it("never presents a live rule's switch as blocked by an active run", () => {
    // The active-run gate is an ENABLE gate. A rule that is already on with a
    // run in flight must stay stoppable.
    expect(wakeupControlState({
      wakeup: rule({ enabled: true }),
      status: "running",
      ...open,
    })).toMatchObject({ kind: "switch", checked: true, disabled: false, blocked: null, enableRevision: null });
  });
});

describe("the enable fence travels with the control", () => {
  it("hands over the revision only when it is actually usable", () => {
    // The structural half of the "no revision ?? 0" rule: the call site spreads
    // this value instead of reading `wakeup.revision`, so a rule whose revision
    // is missing cannot produce web's rejected request (`revision is required`).
    expect(wakeupControlState({
      wakeup: rule({ enabled: false, mode: "continuous", revision: 6 }),
      ...open,
    }).enableRevision).toBe(6);
  });

  it("withholds it when the control is inert", () => {
    expect(wakeupControlState({
      wakeup: rule({ enabled: false, mode: "continuous", revision: undefined }),
      ...open,
    }).enableRevision).toBeNull();
  });

  it("withholds it on an already-enabled rule", () => {
    // Flipping that switch OFF sends no revision at all; offering one would
    // invite a call site to send it on the wrong path.
    expect(wakeupControlState({
      wakeup: rule({ enabled: true, revision: 3 }),
      ...open,
    }).enableRevision).toBeNull();
  });

  it("withholds it on a withdraw, which sends no body", () => {
    expect(wakeupControlState({
      wakeup: rule({ enabled: false, revision: undefined }),
      status: "queued",
      startedAt: null,
      ...open,
    })).toMatchObject({ kind: "withdraw", enableRevision: null });
  });
});

describe("instruction validation", () => {
  it("accepts an instruction at the limit and rejects one past it", () => {
    const max = WAKEUP_INSTRUCTION_MAX_BYTES;
    expect(wakeupInstructionErrorKey("x".repeat(max))).toBeNull();
    expect(wakeupInstructionErrorKey("x".repeat(max + 1))).toBe(
      "wakeups.instructionInvalid",
    );
  });

  it("measures the limit in bytes, not characters", () => {
    // 4001 Chinese characters is 12003 bytes; a character-count check would
    // pass it and the server would answer 400.
    expect(wakeupInstructionErrorKey("任".repeat(4000))).toBeNull();
    expect(wakeupInstructionErrorKey("任".repeat(4001))).toBe(
      "wakeups.instructionInvalid",
    );
  });

  it("rejects an empty or whitespace-only instruction", () => {
    // The server trims, then refuses an empty body ("instruction must be
    // 1–12000 bytes"). Sending it would be a guaranteed 400.
    expect(wakeupInstructionErrorKey("")).toBe("wakeups.instructionInvalid");
    expect(wakeupInstructionErrorKey("   \n ")).toBe("wakeups.instructionInvalid");
  });

  it("holds the system rule to its own smaller limit", () => {
    // `MaxSystemWakeupInstruction = 4000` on the server, not 12000.
    expect(wakeupSystemInstructionErrorKey("x".repeat(
      WAKEUP_SYSTEM_INSTRUCTION_MAX_BYTES,
    ))).toBeNull();
    expect(wakeupSystemInstructionErrorKey("x".repeat(
      WAKEUP_SYSTEM_INSTRUCTION_MAX_BYTES + 1,
    ))).toBe("wakeups.system.instructionInvalid");
  });

  it("lets the system rule be cleared", () => {
    // An empty system instruction is meaningful: it means "follow the
    // default". Refusing it would make the default unreachable again.
    expect(wakeupSystemInstructionErrorKey("")).toBeNull();
  });
});

describe("write-failure classification", () => {
  it("names the permission failure on a 403", () => {
    expect(wakeupWriteErrorKey({ status: 403 }, "wakeups.disableError")).toBe(
      "wakeups.permissionError",
    );
  });

  it("names the conflict on a 409, so the user is told to refresh", () => {
    expect(wakeupWriteErrorKey({ status: 409 }, "wakeups.enableError")).toBe(
      "wakeups.conflictError",
    );
  });

  it("falls back to the caller's line for anything else", () => {
    expect(wakeupWriteErrorKey({ status: 500 }, "wakeups.enableError")).toBe(
      "wakeups.enableError",
    );
    expect(wakeupWriteErrorKey(new Error("offline"), "wakeups.enableError")).toBe(
      "wakeups.enableError",
    );
    expect(wakeupWriteErrorKey(null, "wakeups.enableError")).toBe(
      "wakeups.enableError",
    );
  });
});

describe("post-failure refresh", () => {
  it("refreshes only after a 409, the one failure that means 'the row moved'", () => {
    // Refetching after a network failure or a 403 costs a request and changes
    // nothing: neither says the client's copy of the rule is stale.
    expect(wakeupWriteNeedsRefresh({ status: 409 })).toBe(true);
    expect(wakeupWriteNeedsRefresh({ status: 403 })).toBe(false);
    expect(wakeupWriteNeedsRefresh({ status: 500 })).toBe(false);
    expect(wakeupWriteNeedsRefresh(new Error("offline"))).toBe(false);
    expect(wakeupWriteNeedsRefresh(null)).toBe(false);
    // Same duck-typing rule as the classifier: `"409"` is not a status.
    expect(wakeupWriteNeedsRefresh({ status: "409" })).toBe(false);
  });
});
