import { describe, expect, it } from "vitest";
import type { TaskMessagePayload } from "../types/events";
import {
  buildTimeline,
  coalesceTaskMessages,
  prepareTaskMessages,
  redactTaskMessages,
} from "./build-timeline";

/**
 * Guard for the payload-shaped half of the transcript preparation.
 *
 * Web prepares its transcript with `buildTimeline` (merge flush-split
 * fragments, then mask secrets) and renders `TimelineItem`s. The mobile client
 * renders the raw `TaskMessagePayload` shape instead, so it needs the same two
 * steps without the reshape — and needs them to be *the same* two steps, or a
 * run counts more steps and shows more secrets on the phone than on the web.
 * The parity case below is the load-bearing assertion: it fails if either path
 * drifts from the other.
 */

function message(
  seq: number,
  type: TaskMessagePayload["type"],
  extra: Partial<TaskMessagePayload> = {},
): TaskMessagePayload {
  return { task_id: "task-1", issue_id: "issue-1", seq, type, ...extra };
}

/** `buildTimeline`'s reshape, applied to an already-prepared payload. */
function toTimelineItem(msg: TaskMessagePayload) {
  return {
    seq: msg.seq,
    type: msg.type,
    tool: msg.tool,
    content: msg.content,
    input: msg.input,
    output: msg.output,
    created_at: msg.created_at,
  };
}

describe("coalesceTaskMessages", () => {
  it("merges adjacent thinking fragments split by flush timing", () => {
    const merged = coalesceTaskMessages([
      message(1, "thinking", { content: "weighing " }),
      message(2, "thinking", { content: "the options" }),
      message(3, "tool_use", { tool: "Bash", input: { command: "ls" } }),
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      seq: 1,
      type: "thinking",
      content: "weighing the options",
    });
  });

  it("keeps the payload identity a merged row is keyed on", () => {
    const merged = coalesceTaskMessages([
      message(1, "text", { content: "a", chat_session_id: "sess-1" }),
      message(2, "text", { content: "b" }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.task_id).toBe("task-1");
    expect(merged[0]?.issue_id).toBe("issue-1");
    expect(merged[0]?.chat_session_id).toBe("sess-1");
  });

  it("does not merge across a tool or error boundary", () => {
    const merged = coalesceTaskMessages([
      message(1, "text", { content: "before" }),
      message(2, "tool_use", { tool: "Bash" }),
      message(3, "text", { content: "after" }),
      message(4, "error", { content: "boom" }),
      message(5, "text", { content: "done" }),
    ]);

    expect(merged.map((m) => m.content ?? m.tool)).toEqual([
      "before",
      "Bash",
      "after",
      "boom",
      "done",
    ]);
  });

  it("orders out-of-order fragments by seq before merging", () => {
    const merged = coalesceTaskMessages([
      message(3, "text", { content: "C" }),
      message(1, "text", { content: "A" }),
      message(2, "text", { content: "B" }),
    ]);

    expect(merged).toEqual([
      expect.objectContaining({ seq: 1, content: "ABC" }),
    ]);
  });

  it("keeps the latest created_at, falling back to the previous one", () => {
    const merged = coalesceTaskMessages([
      message(1, "text", { content: "a", created_at: "2026-06-09T09:00:00.000Z" }),
      message(2, "text", { content: "b", created_at: "2026-06-09T09:00:05.000Z" }),
      message(3, "text", { content: "c" }),
    ]);

    expect(merged[0]?.created_at).toBe("2026-06-09T09:00:05.000Z");
  });
});

describe("redactTaskMessages", () => {
  it("masks secrets in content and output, leaving other fields alone", () => {
    const [redacted] = redactTaskMessages([
      message(1, "tool_result", {
        tool: "Bash",
        output: "AKIAIOSFODNN7EXAMPLE",
      }),
    ]);

    expect(redacted?.output).toBe("[REDACTED AWS KEY]");
    expect(redacted?.tool).toBe("Bash");
    expect(redacted?.seq).toBe(1);
  });

  it("masks a secret that only becomes matchable once fragments are joined", () => {
    // `Bearer ` and the token land in separate flushes; masking before the
    // merge would leave the reassembled text unmasked.
    const prepared = prepareTaskMessages([
      message(1, "text", { content: "Authorization: Bearer " }),
      message(2, "text", { content: "abc123xyz.def456" }),
    ]);

    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.content).toBe("Authorization: Bearer [REDACTED]");
  });
});

describe("prepareTaskMessages parity with buildTimeline", () => {
  it("produces exactly the timeline web's buildTimeline produces", () => {
    const stream: TaskMessagePayload[] = [
      message(2, "text", { content: "world" }),
      message(1, "text", { content: "hello " }),
      message(3, "thinking", { content: "step " }),
      message(4, "thinking", { content: "one", created_at: "2026-06-09T09:00:05.000Z" }),
      message(5, "tool_use", { tool: "Bash", input: { command: "echo AKIAIOSFODNN7EXAMPLE" } }),
      message(6, "tool_result", { tool: "Bash", output: "AKIAIOSFODNN7EXAMPLE" }),
      message(7, "error", { content: "boom" }),
    ];

    expect(prepareTaskMessages(stream).map(toTimelineItem)).toEqual(
      buildTimeline(stream),
    );
  });

  it("agrees with buildTimeline on the step count a run reports", () => {
    const stream: TaskMessagePayload[] = [
      message(1, "thinking", { content: "a" }),
      message(2, "thinking", { content: "b" }),
      message(3, "tool_use", { tool: "Read" }),
      message(4, "thinking", { content: "c" }),
      message(5, "text", { content: "narration" }),
    ];

    // The chat fold counts non-text rows, which is what the raw stream
    // inflates: 5 raw rows vs 3 merged ones.
    expect(stream.filter((m) => m.type !== "text")).toHaveLength(4);
    expect(
      prepareTaskMessages(stream).filter((m) => m.type !== "text"),
    ).toHaveLength(3);
    expect(buildTimeline(stream).filter((i) => i.type !== "text")).toHaveLength(3);
  });
});
