import { describe, expect, it } from "vitest";
import {
  partitionTaskLog,
  getToolSummary,
} from "./task-log";
import type { TaskMessagePayload } from "@multica/core/types";

function msg(partial: Partial<TaskMessagePayload> & { type: TaskMessagePayload["type"] }): TaskMessagePayload {
  return {
    task_id: "t1",
    issue_id: "i1",
    seq: 0,
    ...partial,
  };
}

describe("partitionTaskLog", () => {
  it("splits process steps from text narration, preserving order", () => {
    const messages = [
      msg({ seq: 1, type: "text", content: "  thinking aloud  " }),
      msg({ seq: 2, type: "tool_use", tool: "Bash", input: { command: "ls" } }),
      msg({ seq: 3, type: "tool_result", tool: "Bash", output: "ok" }),
      msg({ seq: 4, type: "text", content: "done" }),
    ];
    const { processSteps, textFragments } = partitionTaskLog(messages);
    expect(processSteps.map((m) => m.type)).toEqual([
      "tool_use",
      "tool_result",
    ]);
    expect(textFragments).toEqual(["thinking aloud", "done"]);
  });

  it("drops empty / whitespace-only text chunks", () => {
    const messages = [
      msg({ seq: 1, type: "text", content: "" }),
      msg({ seq: 2, type: "text", content: "   " }),
      msg({ seq: 3, type: "thinking", content: "hmm" }),
    ];
    const { textFragments, processSteps } = partitionTaskLog(messages);
    expect(textFragments).toEqual([]);
    expect(processSteps).toHaveLength(1);
  });

  it("handles empty input", () => {
    expect(partitionTaskLog([])).toEqual({
      processSteps: [],
      textFragments: [],
    });
  });
});

describe("getToolSummary", () => {
  it("prefers query, then file path, pattern, description, command, prompt", () => {
    const base = msg({ type: "tool_use", input: {} as Record<string, unknown> });
    expect(getToolSummary({ ...base, input: { query: "find bug" } })).toBe(
      "find bug",
    );
    expect(
      getToolSummary({ ...base, input: { file_path: "/a/b/c.txt" } }),
    ).toBe("…/b/c.txt");
    expect(
      getToolSummary({ ...base, input: { path: "/x/y/deep/long.txt" } }),
    ).toBe("…/deep/long.txt");
    expect(getToolSummary({ ...base, input: { pattern: "*.md" } })).toBe(
      "*.md",
    );
    expect(
      getToolSummary({ ...base, input: { description: "reads a file" } }),
    ).toBe("reads a file");
  });

  it("truncates long command and prompt", () => {
    const base = msg({ type: "tool_use", input: {} as Record<string, unknown> });
    const longCmd = "x".repeat(150);
    expect(getToolSummary({ ...base, input: { command: longCmd } })).toBe(
      `${"x".repeat(100)}…`,
    );
    const longPrompt = "p".repeat(120);
    expect(getToolSummary({ ...base, input: { prompt: longPrompt } })).toBe(
      `${"p".repeat(100)}…`,
    );
  });

  it("returns empty for no input or empty input", () => {
    const base = msg({ type: "tool_use" });
    expect(getToolSummary({ ...base, input: undefined })).toBe("");
    expect(getToolSummary({ ...base, input: {} })).toBe("");
  });
});