import { describe, it, expect } from "vitest";
import type { AgentTask, TaskUsage } from "@multica/core/types";
import {
  buildRunDetailRows,
  buildUsageDetailRows,
  commentCoverageCount,
  hasRunDetails,
  transcriptTriggerLabelKey,
  transcriptUsageSummary,
} from "./run-transcript-details";

/** A minimal task; every test overrides only what it is about. */
function task(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "t1",
    agent_id: "a1",
    runtime_id: "r1",
    issue_id: "i1",
    status: "completed",
    created_at: "2026-09-29T00:00:00Z",
    ...overrides,
  } as AgentTask;
}

describe("transcriptTriggerLabelKey", () => {
  it("reads a retry off parent_task_id, and it outranks a comment id", () => {
    expect(transcriptTriggerLabelKey(task({ parent_task_id: "p1" }))).toBe(
      "runs.transcript.triggerRetry",
    );
    // A re-attempt of a comment-triggered run is still a retry: "why does this
    // run exist" is answered by the newer fact.
    expect(
      transcriptTriggerLabelKey(
        task({ parent_task_id: "p1", trigger_comment_id: "c1", kind: "comment" }),
      ),
    ).toBe("runs.transcript.triggerRetry");
  });

  it("accepts either the kind or the corresponding id as the signal", () => {
    expect(transcriptTriggerLabelKey(task({ kind: "comment" }))).toBe(
      "runs.transcript.triggerComment",
    );
    expect(transcriptTriggerLabelKey(task({ trigger_comment_id: "c1" }))).toBe(
      "runs.transcript.triggerComment",
    );
    expect(transcriptTriggerLabelKey(task({ kind: "autopilot" }))).toBe(
      "runs.transcript.triggerAutopilot",
    );
    expect(transcriptTriggerLabelKey(task({ autopilot_run_id: "ar1" }))).toBe(
      "runs.transcript.triggerAutopilot",
    );
    expect(transcriptTriggerLabelKey(task({ kind: "chat" }))).toBe(
      "runs.transcript.triggerChat",
    );
    expect(transcriptTriggerLabelKey(task({ chat_session_id: "cs1" }))).toBe(
      "runs.transcript.triggerChat",
    );
  });

  it("treats quick_create as its own trigger, ahead of the direct fallback", () => {
    expect(transcriptTriggerLabelKey(task({ kind: "quick_create" }))).toBe(
      "runs.transcript.triggerQuickCreate",
    );
  });

  it("reads a handoff note as a direct assignment, like web", () => {
    expect(transcriptTriggerLabelKey(task({ kind: "direct" }))).toBe(
      "runs.transcript.triggerDirect",
    );
    expect(transcriptTriggerLabelKey(task({ handoff_note: "please look" }))).toBe(
      "runs.transcript.triggerDirect",
    );
  });

  it("falls back to the initial run for a bare task", () => {
    expect(transcriptTriggerLabelKey(task())).toBe(
      "runs.transcript.triggerInitial",
    );
  });
});

describe("commentCoverageCount", () => {
  it("stays silent for one comment — the ordinary case is not worth a line", () => {
    expect(commentCoverageCount(task({ trigger_comment_id: "c1" }))).toBeNull();
    expect(
      commentCoverageCount(task({ delivered_comment_ids: ["c1"] })),
    ).toBeNull();
  });

  it("stays silent when there is no comment at all", () => {
    expect(commentCoverageCount(task())).toBeNull();
    expect(commentCoverageCount(task({ delivered_comment_ids: [] }))).toBeNull();
  });

  it("counts the unique union of trigger + coalesced on a queued row", () => {
    // Queued rows have no delivery receipt yet, so the plan is all there is.
    expect(
      commentCoverageCount(
        task({
          status: "queued",
          trigger_comment_id: "c1",
          coalesced_comment_ids: ["c2", "c3"],
        }),
      ),
    ).toBe(3);
  });

  it("ignores an empty trigger id when planning, without counting it as one", () => {
    expect(
      commentCoverageCount(
        task({ status: "queued", trigger_comment_id: "", coalesced_comment_ids: ["c1", "c2"] }),
      ),
    ).toBe(2);
  });

  it("prefers the delivery receipt once the row has left queued", () => {
    expect(
      commentCoverageCount(
        task({
          status: "completed",
          trigger_comment_id: "c1",
          coalesced_comment_ids: ["c2", "c3"],
          delivered_comment_ids: ["c2"],
        }),
      ),
    ).toBeNull();
  });

  it("treats an explicit empty receipt as authoritative, not as 'fall back to the plan'", () => {
    // The claim delivered nothing; showing the planned 3 would be a lie about
    // what the agent actually read.
    expect(
      commentCoverageCount(
        task({
          status: "completed",
          trigger_comment_id: "c1",
          coalesced_comment_ids: ["c2", "c3"],
          delivered_comment_ids: [],
        }),
      ),
    ).toBeNull();
  });

  it("dedupes an id that appears in both the trigger and the delivered receipt", () => {
    expect(
      commentCoverageCount(
        task({ status: "completed", delivered_comment_ids: ["c1", "c1", "c2"] }),
      ),
    ).toBe(2);
  });

  it("still plans on a running row with no receipt yet", () => {
    expect(
      commentCoverageCount(
        task({
          status: "running",
          trigger_comment_id: "c1",
          coalesced_comment_ids: ["c2"],
        }),
      ),
    ).toBe(2);
  });
});

describe("buildRunDetailRows", () => {
  const fmt = (iso: string) => `at:${iso}`;

  it("emits only the created time for a bare task with no runtime resolved", () => {
    // The helper's `created_at` is a real timestamp and web renders it too, so
    // the assertion here is that runtime / provider / mode / workdir / branch /
    // reason all stay out when their inputs are absent — not that the list is
    // empty.
    expect(buildRunDetailRows({ task: task(), formatTime: fmt }).map((r) => r.labelKey)).toEqual([
      "runs.transcript.detailsCreated",
    ]);
  });

  it("keeps web's order: runtime, provider, mode, workdir, branch, reason, times", () => {
    const rows = buildRunDetailRows({
      task: task({
        relative_work_dir: "ws/abc/workdir",
        branch_name: "iter183-x",
        error: "daemon too old",
        started_at: "2026-09-29T01:00:00Z",
        completed_at: "2026-09-29T02:00:00Z",
      }),
      runtimeName: "1324 build host",
      providerLabel: "Claude Code",
      runtimeMode: "local",
      formatTime: fmt,
    });
    expect(rows.map((r) => r.labelKey)).toEqual([
      "runs.transcript.detailsRuntime",
      "runs.transcript.detailsProvider",
      "runs.transcript.detailsMode",
      "runs.transcript.detailsWorkdir",
      "runs.transcript.detailsBranch",
      "runs.transcript.detailsReason",
      "runs.transcript.detailsCreated",
      "runs.transcript.detailsStarted",
      "runs.transcript.detailsCompleted",
    ]);
    expect(rows[3].value).toBe("ws/abc/workdir");
    expect(rows[3].mono).toBe(true);
    expect(rows[5].value).toBe("daemon too old");
  });

  it("omits the branch row on this backend, where the field is absent", () => {
    const rows = buildRunDetailRows({
      task: task({ relative_work_dir: "ws/abc/workdir" }),
      formatTime: fmt,
    });
    expect(rows.map((r) => r.labelKey)).toEqual([
      "runs.transcript.detailsWorkdir",
      "runs.transcript.detailsCreated",
    ]);
  });

  it("keeps a cancelled run's persisted error — that is where the reason lives", () => {
    const rows = buildRunDetailRows({
      task: task({ status: "cancelled", error: "cancelled by operator" }),
      formatTime: fmt,
    });
    expect(rows.some((r) => r.labelKey === "runs.transcript.detailsReason")).toBe(
      true,
    );
  });
});

describe("buildUsageDetailRows", () => {
  const toks = (n: number) => `${n}t`;
  const cost = (n: number) => `$${n}`;

  it("returns null for undefined and [] alike — neither means the run was free", () => {
    expect(buildUsageDetailRows(transcriptUsageSummary(undefined), toks, cost)).toBeNull();
    expect(buildUsageDetailRows(transcriptUsageSummary([]), toks, cost)).toBeNull();
  });

  it("always shows input / output / cost", () => {
    const rows = buildUsageDetailRows(
      transcriptUsageSummary([
        {
          model: "claude-sonnet-5",
          input_tokens: 10,
          output_tokens: 20,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
        } as TaskUsage,
      ]),
      toks,
      cost,
    );
    expect(rows?.map((r) => r.labelKey)).toEqual([
      "runs.transcript.detailsInput",
      "runs.transcript.detailsOutput",
      "runs.transcript.detailsCost",
    ]);
  });

  it("hides the cache rows at zero — zero means no cache, not zero cache", () => {
    const rows = buildUsageDetailRows(
      transcriptUsageSummary([
        {
          model: "claude-sonnet-5",
          input_tokens: 1,
          output_tokens: 1,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
        } as TaskUsage,
      ]),
      toks,
      cost,
    );
    expect(rows?.some((r) => r.labelKey.includes("Cache"))).toBe(false);
  });

  it("shows each cache row once it is non-zero", () => {
    const rows = buildUsageDetailRows(
      transcriptUsageSummary([
        {
          model: "claude-sonnet-5",
          input_tokens: 1,
          output_tokens: 1,
          cache_read_tokens: 500,
          cache_write_tokens: 0,
        } as TaskUsage,
      ]),
      toks,
      cost,
    );
    expect(rows?.map((r) => r.labelKey)).toEqual([
      "runs.transcript.detailsInput",
      "runs.transcript.detailsOutput",
      "runs.transcript.detailsCacheRead",
      "runs.transcript.detailsCost",
    ]);
    expect(rows?.[2].value).toBe("500t");
  });

  it("sums multiple model slices into one set of rows", () => {
    const rows = buildUsageDetailRows(
      transcriptUsageSummary([
        {
          model: "claude-sonnet-5",
          input_tokens: 10,
          output_tokens: 20,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
        },
        {
          model: "gpt-5",
          input_tokens: 5,
          output_tokens: 7,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
        },
      ] as TaskUsage[]),
      toks,
      cost,
    );
    expect(rows?.[0].value).toBe("15t");
    expect(rows?.[1].value).toBe("27t");
  });
});

describe("hasRunDetails", () => {
  it("is false when there is nothing to open", () => {
    expect(hasRunDetails([], null)).toBe(false);
    expect(hasRunDetails([], [])).toBe(false);
  });

  it("is true when either the diagnostics or the usage split has a row", () => {
    expect(hasRunDetails([{ labelKey: "k", value: "v" }], null)).toBe(true);
    expect(hasRunDetails([], [{ labelKey: "k", value: "v" }])).toBe(true);
  });
});

describe("transcriptUsageSummary", () => {
  it("gates the chip on a real figure, never on a zeroed one", () => {
    expect(transcriptUsageSummary(undefined)).toBeNull();
    expect(transcriptUsageSummary([])).toBeNull();
    // An all-zero slice is still a recorded figure — the run happened and the
    // server counted it, so the chip may render "0" honestly.
    expect(
      transcriptUsageSummary([
        {
          model: "claude-sonnet-5",
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
        } as TaskUsage,
      ]),
    ).not.toBeNull();
  });
});
