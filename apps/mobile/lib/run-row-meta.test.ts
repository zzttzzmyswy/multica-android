import { describe, expect, it } from "vitest";
import type { AgentTask, TaskUsage } from "@multica/core/types";
import {
  UNDER_A_SECOND,
  runDurationLabel,
  runDurationSeconds,
  runUsageParts,
  shortModelName,
} from "./run-row-meta";
import { summarizeTaskUsage } from "./task-usage";

// Iteration 266 (MYS-2300). The runs sheet's rows showed a token count and a
// relative timestamp and nothing else, while web's row states four facts:
// how long the run took, how many tokens it burned, which model burned them,
// and what they cost. On a phone that is the whole answer to "was this run
// worth it" — a retry on a cheaper model can cost a tenth of the original at
// the same token count, and the two rows were indistinguishable.
//
// These tests pin the decisions, not the JSX: which timestamp pair counts as a
// duration, when a figure is an em dash instead of a zero, and how a model id
// is shortened.

function task(over: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "t1",
    agent_id: "a1",
    runtime_id: "r1",
    issue_id: "i1",
    status: "completed",
    priority: 0,
    dispatched_at: null,
    started_at: "2026-10-09T10:00:00Z",
    completed_at: "2026-10-09T10:02:30Z",
    result: null,
    error: null,
    created_at: "2026-10-09T09:00:00Z",
    ...over,
  } as AgentTask;
}

function usage(over: Partial<TaskUsage> = {}): TaskUsage {
  return {
    model: "claude-sonnet-5",
    provider: "anthropic",
    input_tokens: 1200,
    output_tokens: 300,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    ...over,
  } as TaskUsage;
}

/** A catalog stub that resolves the keys this suite names and echoes the rest,
 *  which is what `lib/i18n`'s `t` does for a key it does not have. */
const CATALOG: Record<string, string> = {
  "failureReason.agent_error.agent_timeout": "Agent timed out",
  "failureReason.provider_network": "Network error reaching provider",
};
const t = (id: string) => CATALOG[id] ?? id;

describe("runDurationSeconds", () => {
  it("measures completed_at minus started_at, never created_at", () => {
    // `created_at` is the QUEUE time. On a busy runtime a run can wait an hour
    // before the agent touches it; reporting that as its length would blame the
    // agent for the queue — the distinction `run-row.tsx` already documents.
    expect(runDurationSeconds(task())).toBe(150);
    const queuedForAnHour = task({
      created_at: "2026-10-09T09:00:00Z",
      started_at: "2026-10-09T10:00:00Z",
      completed_at: "2026-10-09T10:02:30Z",
    });
    expect(runDurationSeconds(queuedForAnHour)).toBe(150);
  });

  it("is null unless BOTH ends are present", () => {
    // A run still executing has no length yet; one that never started has none
    // at all (web gates on the same pair, execution-log-section.tsx:690).
    expect(runDurationSeconds(task({ completed_at: null }))).toBeNull();
    expect(runDurationSeconds(task({ started_at: null }))).toBeNull();
    expect(
      runDurationSeconds(task({ started_at: null, completed_at: null })),
    ).toBeNull();
  });

  it("is null for an unparseable timestamp rather than NaN", () => {
    // A NaN would reach `formatDuration`, whose `Number.isFinite` guard would
    // hide it — but a `null` here is what the row branches on, so the two must
    // agree rather than relying on the formatter's fallback.
    expect(runDurationSeconds(task({ started_at: "not-a-date" }))).toBeNull();
  });

  it("forwards an inverted pair unchanged, and the formatter degrades it", () => {
    // A clock skew between daemon and server can hand us a negative span. Web
    // computes the subtraction without guarding (`execution-log-section.tsx:691`)
    // and lets `formatDuration`'s negative-input branch answer "0s"; this is the
    // same division of labour, so the two clients degrade identically.
    const inverted = task({
      started_at: "2026-10-09T10:02:30Z",
      completed_at: "2026-10-09T10:00:00Z",
    });
    expect(runDurationSeconds(inverted)).toBe(-150);
    expect(runDurationLabel(inverted)).toBe(UNDER_A_SECOND);
  });
});

describe("runDurationLabel", () => {
  it("renders the span in the same notation the timeline above uses", () => {
    expect(runDurationLabel(task())).toBe("2m 30s");
    expect(runDurationLabel(task({ completed_at: "2026-10-09T10:00:45Z" }))).toBe(
      "45s",
    );
  });

  it("degrades a sub-second run to the shared literal, not to 0s of its own", () => {
    // One run must not read "<1m" in the chart and "0s" in the row below it.
    expect(
      runDurationLabel(
        task({ completed_at: new Date(Date.parse("2026-10-09T10:00:00.400Z")).toISOString() }),
      ),
    ).toBe(UNDER_A_SECOND);
    expect(UNDER_A_SECOND).toBe("0s");
  });

  it("is null when the run has no length", () => {
    expect(runDurationLabel(task({ started_at: null }))).toBeNull();
  });
});

describe("shortModelName", () => {
  // The rule is web's `issue-run-timeline.ts:471` verbatim: the same run's
  // model must read the same on both clients.
  it("reads a Claude id as tier + dotted version + variant", () => {
    expect(shortModelName("claude-opus-5-5-high")).toBe("Opus 5.5 high");
    expect(shortModelName("claude-sonnet-5")).toBe("Sonnet 5");
  });

  it("drops a provider prefix and a context-window tag", () => {
    expect(shortModelName("anthropic/claude-opus-5")).toBe("Opus 5");
    expect(shortModelName("claude-opus-5[1m]")).toBe("Opus 5");
  });

  it("reads a gpt id with its version hyphen and capitalised variant", () => {
    expect(shortModelName("gpt-6.1-sol")).toBe("GPT-6.1 Sol");
    expect(shortModelName("gpt-5")).toBe("GPT-5");
  });

  it("keeps a family it does not know unchanged", () => {
    // An unfamiliar id is never renamed into something misleading — web's own
    // reason for the final `return model`.
    expect(shortModelName("deepseek-v4-pro")).toBe("deepseek-v4-pro");
  });

  it("does not produce a truncated or ambiguous label", () => {
    // Two different models must never shorten to the same string; a
    // prefix-truncation would map both of these to "claude-opus…".
    expect(shortModelName("claude-opus-5-5")).not.toBe(
      shortModelName("claude-opus-5-5-high"),
    );
  });
});

describe("runUsageParts", () => {
  it("carries tokens, the first model and cost from one summary", () => {
    const parts = runUsageParts(summarizeTaskUsage([usage()]));
    expect(parts?.tokens).toBe("1.5K");
    expect(parts?.model).toBe("Sonnet 5");
    // 1200 in @ $2/M + 300 out @ $10/M = 0.0024 + 0.003 = $0.0054 → $0.01
    expect(parts?.cost).toBe("$0.01");
  });

  it("takes models[0] in the run's own order", () => {
    const parts = runUsageParts(
      summarizeTaskUsage([
        usage({ model: "claude-haiku-4-5" }),
        usage({ model: "claude-opus-5" }),
      ]),
    );
    expect(parts?.model).toBe("Haiku 4.5");
  });

  it("has no model when the slices carry none", () => {
    const parts = runUsageParts(summarizeTaskUsage([usage({ model: "" })]));
    expect(parts?.model).toBeNull();
  });

  it("is null for a run with no usage at all", () => {
    // `null` means "no figure", not "free". The row renders one em dash for
    // all three fields off this null — the same call `usage-breakdown-dialog`
    // and the sheet's total chip make.
    expect(runUsageParts(null)).toBeNull();
    expect(runUsageParts(summarizeTaskUsage(undefined))).toBeNull();
    expect(runUsageParts(summarizeTaskUsage([]))).toBeNull();
  });
});
