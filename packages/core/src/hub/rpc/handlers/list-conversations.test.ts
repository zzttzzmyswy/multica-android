import { describe, it, expect, vi } from "vitest";
import { createListConversationsHandler } from "./list-conversations.js";

describe("createListConversationsHandler", () => {
  it("lists conversations with closed status", () => {
    const listConversations = vi.fn(() => ["conv-1", "conv-2"]);
    const getConversation = vi.fn((id: string) => (id === "conv-1" ? { closed: false } : { closed: true }));
    const handler = createListConversationsHandler({ listConversations, getConversation });

    const result = handler(undefined, "device-1") as {
      conversations: Array<{ id: string; closed: boolean }>;
    };

    expect(result).toEqual({
      conversations: [
        { id: "conv-1", closed: false },
        { id: "conv-2", closed: true },
      ],
    });
  });

  it("defaults closed=true when conversation is missing", () => {
    const listConversations = vi.fn(() => ["conv-1"]);
    const getConversation = vi.fn(() => undefined);
    const handler = createListConversationsHandler({ listConversations, getConversation });

    const result = handler(undefined, "device-1") as {
      conversations: Array<{ id: string; closed: boolean }>;
    };

    expect(result).toEqual({
      conversations: [{ id: "conv-1", closed: true }],
    });
  });
});
