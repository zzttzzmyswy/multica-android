import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import {
  sanitizeToolCallInputs,
  sanitizeToolUseResultPairing,
} from "./session-transcript-repair.js";

describe("sanitizeToolUseResultPairing", () => {
  it("moves tool results directly after tool calls and inserts missing results", () => {
    const input = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call_1", name: "read", arguments: {} },
          { type: "toolCall", id: "call_2", name: "exec", arguments: {} },
        ],
      },
      { role: "user", content: "user message that should come after tool use" },
      {
        role: "toolResult",
        toolCallId: "call_2",
        toolName: "exec",
        content: [{ type: "text", text: "ok" }],
        isError: false,
      },
    ] as AgentMessage[];

    const out = sanitizeToolUseResultPairing(input);
    expect(out[0]?.role).toBe("assistant");
    expect(out[1]?.role).toBe("toolResult");
    expect((out[1] as { toolCallId?: string }).toolCallId).toBe("call_1");
    expect(out[2]?.role).toBe("toolResult");
    expect((out[2] as { toolCallId?: string }).toolCallId).toBe("call_2");
    expect(out[3]?.role).toBe("user");
  });

  it("drops duplicate tool results for the same id within a span", () => {
    const input = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: "read", arguments: {} }],
      },
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "read",
        content: [{ type: "text", text: "first" }],
        isError: false,
      },
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "read",
        content: [{ type: "text", text: "second" }],
        isError: false,
      },
      { role: "user", content: "ok" },
    ] as AgentMessage[];

    const out = sanitizeToolUseResultPairing(input);
    expect(out.filter((m) => m.role === "toolResult")).toHaveLength(1);
  });

  it("drops duplicate tool results for the same id across the transcript", () => {
    const input = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: "read", arguments: {} }],
      },
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "read",
        content: [{ type: "text", text: "first" }],
        isError: false,
      },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "read",
        content: [{ type: "text", text: "second (duplicate)" }],
        isError: false,
      },
    ] as AgentMessage[];

    const out = sanitizeToolUseResultPairing(input);
    const results = out.filter((m) => m.role === "toolResult") as Array<{
      toolCallId?: string;
    }>;
    expect(results).toHaveLength(1);
    expect(results[0]?.toolCallId).toBe("call_1");
  });

  it("drops orphan tool results that do not match any tool call", () => {
    const input = [
      { role: "user", content: "hello" },
      {
        role: "toolResult",
        toolCallId: "call_orphan",
        toolName: "read",
        content: [{ type: "text", text: "orphan" }],
        isError: false,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
      },
    ] as AgentMessage[];

    const out = sanitizeToolUseResultPairing(input);
    expect(out.some((m) => m.role === "toolResult")).toBe(false);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("drops duplicate assistant messages from abort double-save", () => {
    // Reproduces the bug: session abort saves the same assistant message twice,
    // leaving the second copy with a tool call that has no matching tool result.
    const input = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me write a file" },
          { type: "toolCall", id: "tool_ABC", name: "write", arguments: { path: "/tmp/test.txt", content: "hello" } },
        ],
      },
      // Duplicate from abort handler saving the same message again
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me write a file" },
          { type: "toolCall", id: "tool_ABC", name: "write", arguments: { path: "/tmp/test.txt", content: "hello" } },
        ],
      },
      // User sends a new message after the abort
      { role: "user", content: "hello" },
    ] as AgentMessage[];

    const out = sanitizeToolUseResultPairing(input);

    // Should have: assistant, synthetic toolResult, user
    // The duplicate assistant should be removed
    const assistants = out.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);

    const toolResults = out.filter((m) => m.role === "toolResult") as Array<{ toolCallId?: string }>;
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]?.toolCallId).toBe("tool_ABC");

    const users = out.filter((m) => m.role === "user");
    expect(users).toHaveLength(1);

    // Verify ordering: assistant, toolResult, user
    expect(out.map((m) => m.role)).toEqual(["assistant", "toolResult", "user"]);
  });

  it("drops duplicate assistant followed by error assistant", () => {
    // Full reproduction: duplicate assistant + user + error assistant
    const input = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "tool_ABC", name: "write", arguments: { path: "/tmp/test.txt", content: "hello" } },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "tool_ABC", name: "write", arguments: { path: "/tmp/test.txt", content: "hello" } },
        ],
      },
      { role: "user", content: "continue" },
      { role: "assistant", content: [] },
      { role: "user", content: "how are you" },
      { role: "assistant", content: [] },
    ] as AgentMessage[];

    const out = sanitizeToolUseResultPairing(input);

    // The duplicate assistant should be removed; error assistants are kept (no tool calls)
    const assistants = out.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(3); // original + 2 error assistants

    const toolResults = out.filter((m) => m.role === "toolResult");
    expect(toolResults).toHaveLength(1);
  });

  it("drops tool results with empty tool call id", () => {
    const input = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: "read", arguments: {} }],
      },
      {
        role: "toolResult",
        toolCallId: "",
        toolName: "read",
        content: [{ type: "text", text: "invalid id" }],
        isError: true,
      },
      { role: "user", content: "next" },
    ] as AgentMessage[];

    const out = sanitizeToolUseResultPairing(input);
    const toolResults = out.filter((m) => m.role === "toolResult") as Array<{ toolCallId?: string }>;
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]?.toolCallId).toBe("call_1");
  });
});

describe("sanitizeToolCallInputs", () => {
  it("drops tool calls missing input or arguments", () => {
    const input = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: "read" }],
      },
      { role: "user", content: "hello" },
    ] as AgentMessage[];

    const out = sanitizeToolCallInputs(input);
    expect(out.map((m) => m.role)).toEqual(["user"]);
  });

  it("keeps valid tool calls and preserves text blocks", () => {
    const input = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "before" },
          { type: "toolUse", id: "call_ok", name: "read", input: { path: "a" } },
          { type: "toolCall", id: "call_drop", name: "read" },
        ],
      },
    ] as AgentMessage[];

    const out = sanitizeToolCallInputs(input);
    const assistant = out[0] as Extract<AgentMessage, { role: "assistant" }>;
    const types = Array.isArray(assistant.content)
      ? assistant.content.map((block) => (block as { type?: unknown }).type)
      : [];
    expect(types).toEqual(["text", "toolUse"]);
  });

  it("drops tool calls with empty id even when input exists", () => {
    const input = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "", name: "read", arguments: { path: "a" } },
          { type: "toolUse", id: " ", name: "exec", input: { cmd: "pwd" } },
        ],
      },
      { role: "user", content: "hello" },
    ] as AgentMessage[];

    const out = sanitizeToolCallInputs(input);
    expect(out.map((m) => m.role)).toEqual(["user"]);
  });
});
