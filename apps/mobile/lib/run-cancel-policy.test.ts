/**
 * Pins for the stop-a-run cache policy (MYS-2538).
 *
 * The defect: pressing "stop" removed the run from the active list inside
 * `onMutate`, so the row the user just acted on disappeared — and came back if
 * the request failed. The run still exists on the server (it becomes
 * `cancelled` and stays in the issue's history), so the row must survive the
 * press and say it is stopping.
 */
import { describe, expect, it } from "vitest";
import type { AgentTask } from "@multica/core/types";
import {
  clearCancelRequested,
  isRunStopping,
  markCancelRequested,
  staysActiveWhileStopping,
} from "./run-cancel-policy";

function task(id: string, status: AgentTask["status"] = "running"): AgentTask {
  return {
    id,
    issue_id: "issue-1",
    agent_id: "agent-1",
    status,
  } as AgentTask;
}

describe("isRunStopping", () => {
  it("is true only while the client marker is set", () => {
    // The wire union has no in-between cancellation status, so "stopping" is a
    // client-side phase: the press sets the marker, the server answers with
    // `cancelled`.
    expect(isRunStopping({ cancel_requested: true })).toBe(true);
    expect(isRunStopping({ cancel_requested: false })).toBe(false);
    expect(isRunStopping({})).toBe(false);
  });

  it("does not mistake a still-running task for a stopping one", () => {
    // The old code removed the row here; the marker is what the button reads.
    expect(isRunStopping(task("t1", "running") as never)).toBe(false);
  });
});

describe("staysActiveWhileStopping", () => {
  it("keeps the row visible while the stop is in flight", () => {
    expect(staysActiveWhileStopping()).toBe(true);
  });
});

describe("markCancelRequested", () => {
  it("marks the target without removing it", () => {
    const tasks = [task("t1"), task("t2")];
    const next = markCancelRequested(tasks, "t1")!;
    expect(next).toHaveLength(2);
    expect(next[0].cancel_requested).toBe(true);
    expect(next[1].cancel_requested).toBeUndefined();
  });

  it("does not mutate the array it was given", () => {
    const tasks = [task("t1")];
    markCancelRequested(tasks, "t1");
    expect((tasks[0] as { cancel_requested?: boolean }).cancel_requested).toBe(
      undefined,
    );
  });

  it("returns the same array when the marker is already set", () => {
    const once = markCancelRequested([task("t1")], "t1")!;
    expect(markCancelRequested(once, "t1")).toBe(once);
  });

  it("returns the same array for an unknown id", () => {
    const tasks = [task("t1")];
    expect(markCancelRequested(tasks, "nope")).toBe(tasks);
  });

  it("is a no-op before the cache has loaded", () => {
    expect(markCancelRequested(undefined, "t1")).toBeUndefined();
  });
});

describe("clearCancelRequested", () => {
  it("drops the marker after a failed request, so the row stops claiming it is stopping", () => {
    const marked = markCancelRequested([task("t1")], "t1")!;
    const cleared = clearCancelRequested(marked, "t1")!;
    expect(cleared[0].cancel_requested).toBeUndefined();
    expect(cleared).toHaveLength(1);
  });

  it("returns the same array when there is no marker", () => {
    const tasks = [task("t1")];
    expect(clearCancelRequested(tasks, "t1")).toBe(tasks);
  });
});
