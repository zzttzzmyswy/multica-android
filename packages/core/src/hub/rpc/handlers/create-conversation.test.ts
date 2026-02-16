import { describe, it, expect, vi } from "vitest";
import { createCreateConversationHandler } from "./create-conversation.js";

describe("createCreateConversationHandler", () => {
  it("creates conversation with explicit id", () => {
    const createConversation = vi.fn(() => ({ sessionId: "conv-1" }));
    const handler = createCreateConversationHandler({ createConversation });

    const result = handler({ id: "custom-id" }, "device-1") as { id: string };

    expect(createConversation).toHaveBeenCalledWith("custom-id");
    expect(result).toEqual({ id: "conv-1" });
  });

  it("creates conversation without id when params are missing", () => {
    const createConversation = vi.fn(() => ({ sessionId: "conv-2" }));
    const handler = createCreateConversationHandler({ createConversation });

    const result = handler(undefined, "device-1") as { id: string };

    expect(createConversation).toHaveBeenCalledWith(undefined);
    expect(result).toEqual({ id: "conv-2" });
  });
});
