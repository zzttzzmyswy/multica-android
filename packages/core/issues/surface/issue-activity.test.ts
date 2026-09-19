import { describe, expect, it } from "vitest";
import type { AgentTask } from "../../types";
import {
  deriveIssueSurfaceActivity,
  deriveRunningIssueIds,
  IDLE_ISSUE_AGENT_ACTIVITY,
  isQueuedTaskStatus,
  selectIssueTasks,
  summarizeIssueActivity,
} from "./issue-activity";

function task(
  issueId: string,
  status: AgentTask["status"],
  agentId = "agent-1",
): AgentTask {
  return {
    id: `t-${issueId}-${status}-${agentId}`,
    agent_id: agentId,
    issue_id: issueId,
    status,
  } as AgentTask;
}

describe("isQueuedTaskStatus", () => {
  it("counts the three non-terminal waiting states as queued", () => {
    expect(isQueuedTaskStatus("queued")).toBe(true);
    expect(isQueuedTaskStatus("dispatched")).toBe(true);
    expect(isQueuedTaskStatus("waiting_local_directory")).toBe(true);
  });

  it("does not count running or any terminal state as queued", () => {
    for (const status of [
      "running",
      "completed",
      "failed",
      "cancelled",
    ] as const) {
      expect(isQueuedTaskStatus(status)).toBe(false);
    }
  });
});

describe("selectIssueTasks", () => {
  it("keeps only this issue's non-terminal tasks, bucketed", () => {
    const groups = selectIssueTasks(
      [
        task("a", "running"),
        task("a", "queued"),
        task("a", "dispatched"),
        task("a", "waiting_local_directory"),
        task("a", "completed"),
        task("a", "failed"),
        task("a", "cancelled"),
        task("b", "running"),
      ],
      "a",
    );
    expect(groups.running.map((t) => t.status)).toEqual(["running"]);
    expect(groups.queued.map((t) => t.status)).toEqual([
      "queued",
      "dispatched",
      "waiting_local_directory",
    ]);
  });

  it("returns empty buckets when the issue has no tasks at all", () => {
    expect(selectIssueTasks([task("b", "running")], "a")).toEqual({
      running: [],
      queued: [],
    });
  });
});

describe("summarizeIssueActivity", () => {
  it("is idle with no agents when nothing is in flight", () => {
    expect(summarizeIssueActivity({ running: [], queued: [] })).toEqual(
      IDLE_ISSUE_AGENT_ACTIVITY,
    );
    expect(IDLE_ISSUE_AGENT_ACTIVITY.agentIds).toEqual([]);
  });

  it("reports queued with the queued agents when nothing is running", () => {
    expect(
      summarizeIssueActivity({
        running: [],
        queued: [task("a", "queued", "agent-1")],
      }),
    ).toEqual({ state: "queued", agentIds: ["agent-1"] });
  });

  it("lets running win over queued, and stacks only the running agents", () => {
    // The queued agent must NOT appear: the badge names who is on it now.
    expect(
      summarizeIssueActivity({
        running: [task("a", "running", "agent-2")],
        queued: [task("a", "queued", "agent-1")],
      }),
    ).toEqual({ state: "running", agentIds: ["agent-2"] });
  });

  it("collapses an agent's parallel tasks to one avatar", () => {
    expect(
      summarizeIssueActivity({
        running: [
          task("a", "running", "agent-1"),
          task("a", "running", "agent-1"),
          task("a", "running", "agent-2"),
        ],
        queued: [],
      }),
    ).toEqual({ state: "running", agentIds: ["agent-1", "agent-2"] });
  });
});

describe("deriveRunningIssueIds", () => {
  it("collects distinct issue ids with a running task", () => {
    const ids = deriveRunningIssueIds([
      task("a", "running"),
      task("b", "running"),
      task("a", "running"),
    ]);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });

  it("excludes queued states — the filter promises an agent is on it now", () => {
    const ids = deriveRunningIssueIds([
      task("a", "queued"),
      task("b", "dispatched"),
      task("c", "waiting_local_directory"),
    ]);
    expect(ids.size).toBe(0);
  });

  it("skips tasks with no issue to keep", () => {
    expect([...deriveRunningIssueIds([task("", "running")])]).toEqual([]);
  });
});

describe("deriveIssueSurfaceActivity", () => {
  it("buckets every non-terminal task by issue and derives the running set", () => {
    const surface = deriveIssueSurfaceActivity([
      task("a", "running", "agent-1"),
      task("a", "queued", "agent-2"),
      task("b", "queued", "agent-1"),
      task("c", "completed"),
      task("", "running"),
    ]);

    expect([...surface.activityByIssueId.keys()].sort()).toEqual(["a", "b"]);
    expect(surface.activityByIssueId.get("a")).toMatchObject({
      isWorking: true,
      isQueued: true,
    });
    expect(surface.activityByIssueId.get("b")).toMatchObject({
      isWorking: false,
      isQueued: true,
    });
    // "b" is queued-only and "" has no issue: neither may appear here, or the
    // "agents working now" filter would list issues nobody is working on.
    expect([...surface.runningIssueIds]).toEqual(["a"]);
  });
});
