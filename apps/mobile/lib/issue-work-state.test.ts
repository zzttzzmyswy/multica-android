/**
 * "Is an agent actually working on this issue right now?" — the one question
 * three issue-detail surfaces answer, and the one they answered wrongly.
 *
 * The bug this pins: `GET /api/issues/:id/active-task` returns more than
 * running work. Its SQL (`server/pkg/db/queries/agent.sql:1647`) is
 *
 *     status IN ('queued', 'dispatched', 'running', 'waiting_local_directory')
 *
 * so a task enqueued behind an offline runtime, one the daemon has claimed but
 * not started, and one parked on a busy local_directory lock all come back in
 * the same list. Mobile's detail page read any non-empty list as "an agent is
 * working" and rendered a pulsing dot plus the word "Working" — claiming work
 * was in flight while the task had not started. Not a missing feature: a false
 * statement about the present, on the screen the user opens to check on a run.
 *
 * Web draws the line in `issue-agent-header-chip.tsx`: `running` gets
 * `is_working` ("{{name}} is working") and the border beam; `queued` /
 * `dispatched` / `waiting_local_directory` get `is_queued` ("{{name}} is
 * queued"), half-opacity avatars and no motion. Same fact, different words —
 * and the words are the whole point here.
 *
 * `deferred` is conditional and belongs to neither bucket on its own: it is a
 * retry parked until `fire_at`, so only one with a wakeup behind it is
 * genuinely in line (`isQueuedTaskStatus`, packages/core/issues/surface/
 * issue-activity.ts). Without that condition an orphaned retry would read as
 * live work forever.
 */
import { describe, expect, it } from "vitest";
import {
  partitionIssueWork,
  summarizeIssueWork,
} from "./issue-work-state";

type Task = Parameters<typeof partitionIssueWork>[0][number];

function task(
  status: Task["status"],
  extra: Partial<Task> = {},
): Task {
  return { id: `t-${status}-${Math.random()}`, status, ...extra } as Task;
}

describe("partitionIssueWork — mirrors the server's active-task status set", () => {
  it("treats only `running` as running", () => {
    const { running } = partitionIssueWork([task("running")]);
    expect(running).toHaveLength(1);
  });

  it("buckets the three not-yet-started states as queued", () => {
    // Each of these is a real member of the server's active set. Collapsing
    // any of them into "running" is the original defect.
    for (const status of [
      "queued",
      "dispatched",
      "waiting_local_directory",
    ] as const) {
      const { running, queued } = partitionIssueWork([task(status)]);
      expect(running).toHaveLength(0);
      expect(queued).toHaveLength(1);
    }
  });

  it("counts a deferred retry as queued only when a wakeup will fire it", () => {
    const orphan = partitionIssueWork([task("deferred")]);
    expect(orphan.queued).toHaveLength(0);
    expect(orphan.running).toHaveLength(0);

    const scheduled = partitionIssueWork([
      task("deferred", { wakeup_id: "w1" } as Partial<Task>),
    ]);
    expect(scheduled.queued).toHaveLength(1);
  });

  it("drops terminal rows from both buckets", () => {
    const { running, queued } = partitionIssueWork([
      task("completed"),
      task("failed"),
      task("cancelled"),
    ]);
    expect(running).toHaveLength(0);
    expect(queued).toHaveLength(0);
  });

  it("keeps a mixed list in both buckets at once", () => {
    const { running, queued } = partitionIssueWork([
      task("running"),
      task("queued"),
      task("completed"),
    ]);
    expect(running.map((t) => t.status)).toEqual(["running"]);
    expect(queued.map((t) => t.status)).toEqual(["queued"]);
  });
});

describe("summarizeIssueWork — the claim a surface is allowed to make", () => {
  it("says idle when there is nothing in flight", () => {
    expect(summarizeIssueWork([task("completed")]).state).toBe("idle");
  });

  it("says running, with the agents, when anything is truly running", () => {
    const summary = summarizeIssueWork([
      task("queued"),
      task("running", { agent_id: "a1" } as Partial<Task>),
    ]);
    expect(summary.state).toBe("running");
    expect(summary.agentIds).toEqual(["a1"]);
  });

  it("says queued — not running — when nothing has started", () => {
    const summary = summarizeIssueWork([
      task("queued", { agent_id: "a1" } as Partial<Task>),
      task("dispatched", { agent_id: "a2" } as Partial<Task>),
    ]);
    expect(summary.state).toBe("queued");
    expect(summary.agentIds.sort()).toEqual(["a1", "a2"]);
  });

  it("lists distinct agents, counting one agent's two tasks once", () => {
    // A retried run leaves two queued rows for the same agent; "2 agents
    // queued" would be wrong and is the kind of over-count a raw length gives.
    const summary = summarizeIssueWork([
      task("queued", { agent_id: "a1" } as Partial<Task>),
      task("queued", { agent_id: "a1" } as Partial<Task>),
    ]);
    expect(summary.agentIds).toEqual(["a1"]);
  });

  it("keeps running's agents on screen when both buckets are populated", () => {
    // Running wins the label, and the faces should be the ones actually
    // working — not a queue holder the reader is not waiting on.
    const summary = summarizeIssueWork([
      task("queued", { agent_id: "a-q" } as Partial<Task>),
      task("running", { agent_id: "a-r" } as Partial<Task>),
    ]);
    expect(summary.state).toBe("running");
    expect(summary.agentIds).toEqual(["a-r"]);
  });
});
