/**
 * `deriveRunningIssueIds` — the mobile projection behind the "only issues an
 * agent is working on" filter. Mirrors the `runningIssueIds` half of web's
 * `deriveIssueSurfaceActivity` (packages/views/issues/surface/activity.ts).
 *
 * The two things that can silently break this: counting a non-running task
 * (the list then shows issues nobody is working on), and keeping a chat/
 * autopilot task's empty `issue_id` (which matches no issue row).
 */
import { describe, expect, it } from "vitest";
import type { AgentTask } from "@multica/core/types";
import { deriveRunningIssueIds } from "./running-issues";

function task(
  issueId: string,
  status: AgentTask["status"],
): AgentTask {
  return { id: `t-${issueId}-${status}`, issue_id: issueId, status } as AgentTask;
}

describe("deriveRunningIssueIds", () => {
  it("returns an empty set for an empty snapshot", () => {
    expect(deriveRunningIssueIds([]).size).toBe(0);
  });

  it("keeps issue ids with a running task", () => {
    expect(
      [...deriveRunningIssueIds([task("a", "running"), task("b", "running")])],
    ).toEqual(["a", "b"]);
  });

  it("excludes every non-running status", () => {
    // queued / dispatched / waiting_local_directory are active but not
    // running — web's agentRunningFilter counts running only, because a
    // queued task means nobody has started on the issue yet.
    const ids = deriveRunningIssueIds([
      task("queued", "queued"),
      task("dispatched", "dispatched"),
      task("held", "waiting_local_directory"),
      task("done", "completed"),
      task("failed", "failed"),
      task("cancelled", "cancelled"),
      task("live", "running"),
    ]);
    expect([...ids]).toEqual(["live"]);
  });

  it("drops tasks with no issue (chat / autopilot)", () => {
    // `issue_id` is "" for chat- and autopilot-spawned tasks. An empty
    // string in the set would never match an issue, but it would still be
    // a lie in the roster count.
    expect(
      [...deriveRunningIssueIds([task("", "running"), task("a", "running")])],
    ).toEqual(["a"]);
  });

  it("dedupes several running tasks on the same issue", () => {
    const ids = deriveRunningIssueIds([
      task("a", "running"),
      { ...task("a", "running"), id: "second" } as AgentTask,
    ]);
    expect(ids.size).toBe(1);
    expect(ids.has("a")).toBe(true);
  });
});
