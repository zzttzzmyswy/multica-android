/**
 * Unit tests for the autopilot run-list model (`lib/autopilot-runs.ts`) — the
 * pure half of web's `packages/views/autopilots/components/autopilot-detail-
 * page.tsx` (`RunHistoryList` / `SkippedRunsGroup` / `RunRow`'s synthetic
 * task).
 *
 * Web splits the fetched runs into "visible" and "skipped" buckets and folds
 * the skipped tail behind one toggle row, so a schedule that keeps getting
 * pre-flight-rejected cannot bury the runs a user actually came to read. Web
 * also renders a transcript button ONLY for run-only runs (a task id with no
 * linked issue) — issue-mode runs navigate to the issue instead.
 */
import { describe, expect, it } from "vitest";
import type { AutopilotRun } from "@multica/core/types";
import {
  AUTOPILOT_RUNS_MAX_LIMIT,
  AUTOPILOT_RUNS_PAGE_SIZE,
  canLoadMoreRuns,
  runTaskStatus,
  runTranscriptTaskId,
  splitAutopilotRuns,
} from "./autopilot-runs";

function run(id: string, partial: Partial<AutopilotRun> = {}): AutopilotRun {
  return {
    id,
    autopilot_id: "ap-1",
    trigger_id: null,
    status: "completed",
    source: "schedule",
    triggered_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:00:05Z",
    created_at: "2026-01-01T00:00:00Z",
    issue_id: null,
    task_id: null,
    failure_reason: null,
    trigger_payload: null,
    result: null,
    ...partial,
  };
}

describe("splitAutopilotRuns", () => {
  it("returns empty buckets for an empty list", () => {
    expect(splitAutopilotRuns([])).toEqual({ visible: [], skipped: [] });
  });

  it("puts every non-skipped run in visible, order preserved", () => {
    const runs = [
      run("a", { status: "completed" }),
      run("b", { status: "running" }),
      run("c", { status: "failed" }),
    ];
    const { visible, skipped } = splitAutopilotRuns(runs);
    expect(visible.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(skipped).toEqual([]);
  });

  it("moves only skipped runs into the skipped bucket", () => {
    const runs = [
      run("a", { status: "completed" }),
      run("b", { status: "skipped" }),
      run("c", { status: "skipped" }),
      run("d", { status: "issue_created" }),
    ];
    const { visible, skipped } = splitAutopilotRuns(runs);
    expect(visible.map((r) => r.id)).toEqual(["a", "d"]);
    expect(skipped.map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("handles an all-skipped window", () => {
    const runs = [run("a", { status: "skipped" }), run("b", { status: "skipped" })];
    const { visible, skipped } = splitAutopilotRuns(runs);
    expect(visible).toEqual([]);
    expect(skipped.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("runTranscriptTaskId", () => {
  it("returns the task id for a run-only run", () => {
    expect(runTranscriptTaskId(run("a", { task_id: "task-1" }))).toBe("task-1");
  });

  it("returns null for an issue-mode run even when a task id exists", () => {
    // Web gates the transcript button on `syntheticTask && !run.issue_id`:
    // issue runs link to the issue, not to the raw transcript.
    expect(
      runTranscriptTaskId(run("a", { task_id: "task-1", issue_id: "iss-1" })),
    ).toBeNull();
  });

  it("returns null when the run was never dispatched to a task", () => {
    expect(
      runTranscriptTaskId(run("a", { task_id: null, issue_id: null })),
    ).toBeNull();
    expect(runTranscriptTaskId(run("a", { task_id: "" }))).toBeNull();
  });
});

describe("runTaskStatus", () => {
  it("maps the run statuses web maps", () => {
    expect(runTaskStatus(run("a", { status: "running" }))).toBe("running");
    expect(runTaskStatus(run("a", { status: "completed" }))).toBe("completed");
    expect(runTaskStatus(run("a", { status: "failed" }))).toBe("failed");
  });

  it("falls back to queued for everything else", () => {
    // Web's ternary chain ends in "queued", so issue_created / skipped /
    // any server-side status the client does not know all read as queued.
    expect(runTaskStatus(run("a", { status: "issue_created" }))).toBe("queued");
    expect(runTaskStatus(run("a", { status: "skipped" }))).toBe("queued");
    expect(
      runTaskStatus(
        run("a", { status: "some_future_status" as AutopilotRun["status"] }),
      ),
    ).toBe("queued");
  });
});

describe("canLoadMoreRuns", () => {
  it("offers more while a full page came back and the cap is not reached", () => {
    expect(canLoadMoreRuns(AUTOPILOT_RUNS_PAGE_SIZE, AUTOPILOT_RUNS_PAGE_SIZE)).toBe(
      true,
    );
  });

  it("stops when the server returned a short page", () => {
    expect(canLoadMoreRuns(AUTOPILOT_RUNS_PAGE_SIZE - 1, AUTOPILOT_RUNS_PAGE_SIZE)).toBe(
      false,
    );
    expect(canLoadMoreRuns(0, AUTOPILOT_RUNS_PAGE_SIZE)).toBe(false);
  });

  it("stops at the server's own limit ceiling", () => {
    // The runs endpoint clamps limit to 100, so a full page at the ceiling
    // means "no more to ask for" rather than "there is another page".
    expect(canLoadMoreRuns(AUTOPILOT_RUNS_MAX_LIMIT, AUTOPILOT_RUNS_MAX_LIMIT)).toBe(
      false,
    );
    expect(canLoadMoreRuns(120, 120)).toBe(false);
  });
});
