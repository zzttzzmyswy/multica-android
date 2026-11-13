// @vitest-environment node
/**
 * The handoff confirmation's PURE decisions, pinned to upstream
 * `packages/views/workflows/handoff-confirm-dialog.tsx` (MUL-7420).
 *
 * Every rule below is transcribed from that file's own logic, not invented
 * here — the module under test is a hand-copy of decisions the desktop makes
 * in JSX, which is exactly the kind that drifts silently. When upstream changes
 * a rule this file must be re-transcribed rather than "fixed" until green.
 *
 * The three mutations the iteration's acceptance gate names are covered here by
 * name: a failed read must never become "no handoff", the stop default must
 * stay ON, and the duration buckets must break at 1 and 60 minutes.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_HANDOFF_PREVIEW,
  handoffConfirmRead,
  handoffDurationKey,
  handoffSentenceKind,
  handoffStopDefault,
  handoffStopPayload,
  handoffTargetStatus,
  handoffGateKind,
  HANDOFF_HANDOFF_RUN_STATUSES,
  isHandoffRunStarted,
  type HandoffPreviewLike,
} from "./workflow-handoff";

const preview = (over: Partial<HandoffPreviewLike> = {}): HandoffPreviewLike => ({
  handoff: true,
  workflow_name: "Content",
  from_status: "todo",
  to_status: "in_progress",
  handler_type: "agent",
  handler_id: "agent-1",
  previous_assignee_type: "agent",
  previous_assignee_id: "agent-2",
  previous_runs: [],
  brief: "You are handling in_progress.",
  ...over,
});

describe("isHandoffRunStarted", () => {
  // A queued run has not started: stopping it CANCELS rather than interrupts,
  // and there is no elapsed time to print. `dispatched` counts as started —
  // the daemon has taken it, so stopping interrupts real work.
  it("treats running and dispatched as started", () => {
    expect(HANDOFF_HANDOFF_RUN_STATUSES).toContain("running");
    expect(isHandoffRunStarted({ status: "running" })).toBe(true);
    expect(isHandoffRunStarted({ status: "dispatched" })).toBe(true);
  });

  it("does not treat a queued run as started", () => {
    expect(isHandoffRunStarted({ status: "queued" })).toBe(false);
    expect(isHandoffRunStarted({ status: "" })).toBe(false);
    // Unknown future statuses must not crash the dialog — they read as "not
    // started", which is the conservative half (the copy still offers to stop).
    expect(isHandoffRunStarted({ status: "some_future_status" })).toBe(false);
  });
});

describe("handoffDurationKey", () => {
  const at = (minutesAgo: number) =>
    new Date(Date.UTC(2026, 0, 1, 12, 0, 0) - minutesAgo * 60_000).toISOString();
  const now = new Date(Date.UTC(2026, 0, 1, 12, 0, 0)).getTime();

  it("says under_minute when there is no start time at all", () => {
    // Server answers null for a run that never recorded `started_at`.
    expect(handoffDurationKey(null, now)).toEqual({ key: "under_minute", count: 0 });
  });

  it("says under_minute below one full minute", () => {
    expect(handoffDurationKey(at(0), now)).toEqual({ key: "under_minute", count: 0 });
    expect(handoffDurationKey(at(0.9), now)).toEqual({ key: "under_minute", count: 0 });
  });

  it("counts whole minutes from 1 up to 59", () => {
    expect(handoffDurationKey(at(1), now)).toEqual({ key: "minutes", count: 1 });
    expect(handoffDurationKey(at(59), now)).toEqual({ key: "minutes", count: 59 });
    // 59.9 minutes floors to 59 — the boundary is the FLOOR, not rounding.
    expect(handoffDurationKey(at(59.9), now)).toEqual({ key: "minutes", count: 59 });
  });

  it("switches to hours exactly at 60 minutes, not 61", () => {
    // This is the bucket boundary the acceptance gate names: 59 -> minutes,
    // 60 -> hours. An off-by-one here prints "60 minutes" / "0 hours".
    expect(handoffDurationKey(at(60), now)).toEqual({ key: "hours", count: 1 });
    expect(handoffDurationKey(at(119), now)).toEqual({ key: "hours", count: 1 });
    expect(handoffDurationKey(at(120), now)).toEqual({ key: "hours", count: 2 });
  });

  it("never reports a negative duration when the clock skews", () => {
    // A run whose started_at is slightly in the future (server/client skew)
    // must read as "under a minute", not "-1 minutes".
    expect(handoffDurationKey(at(-5), now)).toEqual({ key: "under_minute", count: 0 });
  });
});

describe("handoffTargetStatus", () => {
  it("uses the requested status for a plain move", () => {
    expect(handoffTargetStatus({ preview: null, toStatus: "in_progress" })).toBe("in_progress");
  });

  it("prefers the preview's own to_status when moving into a project", () => {
    // A project move lands on a column the client cannot predict, so the
    // server's answer wins; `toStatus` is empty in that form.
    const p = preview({ to_status: "in_review" });
    expect(handoffTargetStatus({ preview: p, toStatus: "", toProject: true })).toBe("in_review");
  });

  it("ignores the preview's to_status for a plain move", () => {
    // A stale preview must not relabel the column the user actually picked.
    const p = preview({ to_status: "in_review" });
    expect(handoffTargetStatus({ preview: p, toStatus: "in_progress" })).toBe("in_progress");
  });

  it("falls back to the requested status when a project move has no preview yet", () => {
    expect(handoffTargetStatus({ preview: null, toStatus: "", toProject: true })).toBe("");
  });
});

describe("handoffGateKind — the read-failure rule", () => {
  it("asks while the preview is still loading", () => {
    expect(handoffGateKind({ isPending: true, isError: false, preview: null })).toBe("pending");
  });

  it("before clicking, it proceeds WITHOUT confirmation — upstream behaviour", () => {
    // Upstream applies the move silently when the preview resolves to
    // `handoff: false`: the write still applies the workflow, only the
    // confirmation is skipped.
    expect(
      handoffGateKind({ isPending: false, isError: false, preview: { ...EMPTY_HANDOFF_PREVIEW } }),
    ).toBe("noHandoff");
  });

  it("shows the dialog when the preview reports a handoff", () => {
    expect(handoffGateKind({ isPending: false, isError: false, preview: preview() })).toBe(
      "confirm",
    );
  });

  it("MUTATION GUARD: a failed read is its own state, never 'no handoff'", () => {
    // This is the defect class the repo has hit three times (iter 251/254/256):
    // folding a failed read into the confident answer. If this assertion fails,
    // a failed read is being reported as "there is no handoff", and the phone
    // silently reassigns exactly as before this iteration.
    expect(handoffGateKind({ isPending: false, isError: true, preview: null })).toBe("error");
    expect(handoffGateKind({ isPending: false, isError: true, preview: preview() })).toBe("error");
  });

  it("a missing preview with no error and no pending is a failed read too", () => {
    // Defensive: `preview === null` with neither flag set means the read never
    // produced an answer. Reporting "noHandoff" here would be the same lie.
    expect(handoffGateKind({ isPending: false, isError: false, preview: null })).toBe("error");
  });
});

describe("handoffConfirmRead", () => {
  it("reports failure as failure, with an actionable sentence", () => {
    const read = handoffConfirmRead({ isPending: false, isError: true, preview: null });
    expect(read.state).toBe("error");
    expect(read.failure).toBe("unreadable");
    // The gate is NOT satisfied: the dialog refuses to confirm.
    expect(read.canConfirm).toBe(false);
  });

  it("allows the plain move once a preview says there is no handoff", () => {
    const read = handoffConfirmRead({ isPending: false, isError: false, preview: EMPTY_HANDOFF_PREVIEW });
    expect(read.state).toBe("noHandoff");
    expect(read.failure).toBeNull();
    expect(read.canConfirm).toBe(true);
  });

  it("blocks confirming while the dialog is still checking", () => {
    const read = handoffConfirmRead({ isPending: true, isError: false, preview: null });
    expect(read.state).toBe("pending");
    expect(read.canConfirm).toBe(false);
  });
});

describe("handoffStopDefault / handoffStopPayload", () => {
  it("MUTATION GUARD: the stop choice defaults to ON", () => {
    // Upstream seeds `useState(true)`. A default of false is the "let two
    // agents work the same issue" defect, so it is pinned by name.
    expect(handoffStopDefault()).toBe(true);
  });

  it("sends stop_previous_assignee_runs only when it is meaningful", () => {
    const p = preview({ previous_runs: [{ task_id: "t1", agent_id: "a", status: "running", started_at: null }] });
    expect(handoffStopPayload({ preview: p, stop: true })).toEqual({
      stop_previous_assignee_runs: true,
    });
  });

  it("sends nothing when the user unchecked stop", () => {
    const p = preview({ previous_runs: [{ task_id: "t1", agent_id: "a", status: "running", started_at: null }] });
    expect(handoffStopPayload({ preview: p, stop: false })).toEqual({});
  });

  it("sends nothing when there are no runs to stop", () => {
    // Upstream: `stop && runs.length > 0 && !sameHandler`. Sending the flag
    // with no runs would ask the server to stop something that does not exist.
    expect(handoffStopPayload({ preview: preview({ previous_runs: [] }), stop: true })).toEqual({});
  });

  it("sends nothing when the handler is the SAME actor already assigned", () => {
    // Stopping the run of the agent that is about to keep the issue would
    // cancel the handler's own work.
    const p = preview({
      handler_type: "agent",
      handler_id: "agent-1",
      previous_assignee_type: "agent",
      previous_assignee_id: "agent-1",
      previous_runs: [{ task_id: "t1", agent_id: "agent-1", status: "running", started_at: null }],
    });
    expect(handoffStopPayload({ preview: p, stop: true })).toEqual({});
  });
});

describe("handoffSentenceKind", () => {
  it("is null without a handoff", () => {
    expect(handoffSentenceKind(preview({ handoff: false }))).toBeNull();
  });

  it("is null when the handler types are unusable", () => {
    // A body that drifted to an unknown handler type must render no sentence
    // rather than a sentence with a blank actor name.
    expect(handoffSentenceKind(preview({ handler_type: null, handler_id: null }))).toBeNull();
  });

  it("says same_handler_run when the handler is already the assignee", () => {
    const p = preview({
      handler_type: "member",
      handler_id: "m1",
      previous_assignee_type: "member",
      previous_assignee_id: "m1",
    });
    expect(handoffSentenceKind(p)).toBe("sameHandler");
  });

  it("says reassign for a member handler — no run starts", () => {
    expect(handoffSentenceKind(preview({ handler_type: "member" }))).toBe("reassign");
  });

  it("says reassign_run for an agent handler — a run starts", () => {
    expect(handoffSentenceKind(preview({ handler_type: "agent" }))).toBe("reassignRun");
    expect(handoffSentenceKind(preview({ handler_type: "squad" }))).toBe("reassignRun");
  });
});
