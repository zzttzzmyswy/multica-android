/**
 * `AgentTask` steering metadata parsing (iteration 298).
 *
 * `isSteerableTask` decides whether the phone offers "add to current run" for
 * a recipient. It reads two fields — `supplement_capability` (the runtime
 * negotiated the feature) and `can_supplement` (this caller may use it).
 *
 * `AgentTaskSchema` is `.loose()`, so both fields reached the app before this
 * iteration purely by passthrough. That is not the same as parsing them: a
 * non-boolean `can_supplement` would then be judged by JavaScript truthiness
 * inside `isSteerableTask` (`"false"` is truthy), offering a menu entry the
 * server rejects. The schema now declares each field with a degrade-to-absent
 * preprocess, so a malformed value lands on exactly the same state an older
 * server produces — "not steerable" — instead of a wrong one.
 */
import { describe, expect, it } from "vitest";
import { AgentTaskListSchema } from "@/data/schemas";

const base = {
  id: "t1",
  agent_id: "a1",
  runtime_id: "r1",
  issue_id: "i1",
  created_at: "2026-11-19T00:00:00Z",
  status: "running",
};

describe("AgentTaskSchema steering metadata", () => {
  it("keeps a well-formed capability and permission", () => {
    const [task] = AgentTaskListSchema.parse([
      {
        ...base,
        supplement_capability: "task-supplement-v1",
        can_supplement: true,
        supplement_comment_ids: ["c1", "c2"],
      },
    ]);
    expect(task?.supplement_capability).toBe("task-supplement-v1");
    expect(task?.can_supplement).toBe(true);
    expect(task?.supplement_comment_ids).toEqual(["c1", "c2"]);
  });

  it("drops a non-boolean can_supplement rather than trusting truthiness", () => {
    // The dangerous shape: `"false"` is a truthy string, so an untouched
    // passthrough would offer steering the server refuses.
    const [task] = AgentTaskListSchema.parse([
      { ...base, supplement_capability: "task-supplement-v1", can_supplement: "false" },
    ]);
    expect(task?.can_supplement).toBeUndefined();
  });

  it("drops a non-string capability", () => {
    const [task] = AgentTaskListSchema.parse([
      { ...base, supplement_capability: 3, can_supplement: true },
    ]);
    expect(task?.supplement_capability).toBeUndefined();
    // The permission still parsed — one malformed field costs only itself.
    expect(task?.can_supplement).toBe(true);
  });

  it("drops a malformed comment id list without failing the whole task", () => {
    const [task] = AgentTaskListSchema.parse([
      { ...base, supplement_comment_ids: [1, 2, 3] },
    ]);
    expect(task?.supplement_comment_ids).toBeUndefined();
    expect(task?.id).toBe("t1");
  });

  it("leaves an older server's response with no steering fields intact", () => {
    // Before the feature the fields are simply absent; the task must still
    // parse (the whole task list is one query, so a strict schema here would
    // blank the execution log on any pre-steering deployment).
    const [task] = AgentTaskListSchema.parse([base]);
    expect(task?.supplement_capability).toBeUndefined();
    expect(task?.can_supplement).toBeUndefined();
    expect(task?.status).toBe("running");
  });
});
