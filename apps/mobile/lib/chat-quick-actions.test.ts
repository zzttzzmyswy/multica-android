/**
 * Pins the three cases that separate the real strip from a naive
 * "cut at the last fence": a fence followed by prose is an ordinary example,
 * no fence means the content is untouched, and only the LAST fence is a
 * candidate. Mirrors `packages/views/chat/lib/quick-actions.ts`.
 */
import { describe, expect, it } from "vitest";
import { stripChatQuickActionsProtocol } from "./chat-quick-actions";

describe("stripChatQuickActionsProtocol", () => {
  it("returns content without a fence unchanged", () => {
    const content = "Just a normal reply.\n\nWith two paragraphs.";
    expect(stripChatQuickActionsProtocol(content)).toBe(content);
  });

  it("drops the trailing footer and keeps the prose above it", () => {
    const content =
      'Here is your answer.\n\n```quick-actions\n[{"label":"Go deeper","prompt":"Tell me more"}]\n```';
    expect(stripChatQuickActionsProtocol(content)).toBe("Here is your answer.");
  });

  it("keeps a fence that has real prose after it", () => {
    // An ordinary example in the reply, not the reserved trailing footer.
    const content =
      'The protocol looks like:\n\n```quick-actions\n{"label":"x"}\n```\n\nThat is all.';
    expect(stripChatQuickActionsProtocol(content)).toBe(content);
  });

  it("strips only the last of several fences", () => {
    const content =
      'Example:\n\n```quick-actions\n{"label":"example"}\n```\n\nReal answer.\n\n```quick-actions\n[{"label":"Next","prompt":"p"}]\n```';
    expect(stripChatQuickActionsProtocol(content)).toBe(
      'Example:\n\n```quick-actions\n{"label":"example"}\n```\n\nReal answer.',
    );
  });

  it("strips an unterminated fence — the mid-stream case", () => {
    // While the daemon is still flushing the footer, the closing fence has not
    // arrived. This is the window the function exists to close.
    const content = 'Partial answer so far.\n\n```quick-actions\n[{"label":"Go';
    expect(stripChatQuickActionsProtocol(content)).toBe("Partial answer so far.");
  });

  it("treats a fence as a footer only at a line start", () => {
    const content = 'Use the ```quick-actions marker inline.';
    expect(stripChatQuickActionsProtocol(content)).toBe(content);
  });
});
