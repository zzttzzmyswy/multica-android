import { describe, expect, it } from "vitest";
import { AgentTaskListSchema } from "@/data/schemas";

/**
 * The run-transcript fields (iteration 183).
 *
 * Three regressions are pinned here, all checked against the live backend
 * (`GET /api/issues/:id/task-runs`):
 *
 * 1. `usage` arriving unvalidated. `AgentTaskSchema` is `.loose()`, which
 *    passes an undeclared key through verbatim — so before this declaring the
 *    field, a slice like `{ input_tokens: "12" }` reached `estimateCost` and
 *    turned every figure on the surface into `NaN`. Declaring the shape with
 *    per-field defaults keeps a slice missing one counter priceable on the
 *    counters it does have (core's stated rule for this shape).
 * 2. `coalesced_comment_ids` / `delivered_comment_ids` degrading independently.
 *    A malformed coverage list must cost the row its coverage count, not erase
 *    the task from the runs list.
 * 3. `relative_work_dir` surviving the parse at all — the transcript panel
 *    prints it, and it is a declared field now rather than loose passthrough.
 */
const base = {
  id: "t1",
  agent_id: "a1",
  runtime_id: "r1",
  issue_id: "i1",
  status: "completed",
  created_at: "2026-09-29T00:00:00Z",
};

describe("AgentTaskListSchema usage", () => {
  it("defaults a slice's counters rather than failing the row", () => {
    const [task] = AgentTaskListSchema.parse([
      { ...base, usage: [{ provider: "claude", model: "claude-sonnet-5" }] },
    ]);
    expect(task.usage).toEqual([
      {
        provider: "claude",
        model: "claude-sonnet-5",
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
      },
    ]);
  });

  it("collapses a mistyped counter to 'no usage recorded' rather than leaking a string into the cost math", () => {
    // `usage` is `.catch(undefined)` at the array level (core's shape), so a
    // slice that fails to parse takes the whole list down with it. That is the
    // safe direction: the surface then shows no figure instead of `NaN`, and a
    // string counter can never reach `estimateCost`.
    const [task] = AgentTaskListSchema.parse([
      {
        ...base,
        usage: [{ model: "m", input_tokens: "12", output_tokens: 5 }],
      },
    ]);
    expect(task.usage).toBeUndefined();
  });

  it("collapses a wholly malformed usage list to 'no usage recorded'", () => {
    const [task] = AgentTaskListSchema.parse([{ ...base, usage: "nope" }]);
    expect(task.usage).toBeUndefined();
    // The task itself survives — usage is additive display metadata.
    expect(task.id).toBe("t1");
  });

  it("keeps an explicit empty list as an empty list, not undefined", () => {
    // `[]` and `undefined` both render "no figure", but only the first means
    // "the server looked and found none" — collapsing them would hide that.
    const [task] = AgentTaskListSchema.parse([{ ...base, usage: [] }]);
    expect(task.usage).toEqual([]);
  });
});

describe("AgentTaskListSchema comment coverage", () => {
  it("parses both coverage lists", () => {
    const [task] = AgentTaskListSchema.parse([
      {
        ...base,
        trigger_comment_id: "c1",
        coalesced_comment_ids: ["c2", "c3"],
        delivered_comment_ids: ["c1", "c2"],
      },
    ]);
    expect(task.coalesced_comment_ids).toEqual(["c2", "c3"]);
    expect(task.delivered_comment_ids).toEqual(["c1", "c2"]);
  });

  it("degrades a malformed coverage list to absent without erasing the task", () => {
    const [task] = AgentTaskListSchema.parse([
      { ...base, coalesced_comment_ids: [{ not: "an id" }], delivered_comment_ids: 7 },
    ]);
    expect(task.coalesced_comment_ids).toBeUndefined();
    expect(task.delivered_comment_ids).toBeUndefined();
    expect(task.status).toBe("completed");
  });

  it("keeps an explicit empty receipt, which is the authoritative 'delivered none'", () => {
    const [task] = AgentTaskListSchema.parse([{ ...base, delivered_comment_ids: [] }]);
    expect(task.delivered_comment_ids).toEqual([]);
  });
});

describe("AgentTaskListSchema transcript fields", () => {
  it("parses relative_work_dir, branch_name and handoff_note", () => {
    const [task] = AgentTaskListSchema.parse([
      {
        ...base,
        relative_work_dir: "ws/abc/workdir",
        branch_name: "iter183-x",
        handoff_note: "take over the migration",
      },
    ]);
    expect(task.relative_work_dir).toBe("ws/abc/workdir");
    expect(task.branch_name).toBe("iter183-x");
    expect(task.handoff_note).toBe("take over the migration");
  });

  it("leaves them absent on the per-agent endpoint's payload shape", () => {
    // This backend omits all three on GET /api/agents/:id/tasks; the panel's
    // rows are conditional so the surface degrades to what it does have.
    const [task] = AgentTaskListSchema.parse([{ ...base }]);
    expect(task.relative_work_dir).toBeUndefined();
    expect(task.branch_name).toBeUndefined();
    expect(task.usage).toBeUndefined();
  });
});
