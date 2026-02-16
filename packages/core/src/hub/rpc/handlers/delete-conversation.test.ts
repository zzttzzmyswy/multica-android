import { describe, it, expect, vi } from "vitest";
import { RpcError } from "../dispatcher.js";
import { createDeleteConversationHandler } from "./delete-conversation.js";

describe("createDeleteConversationHandler", () => {
  it("throws INVALID_PARAMS when params are not an object", () => {
    const closeConversation = vi.fn();
    const handler = createDeleteConversationHandler({ closeConversation });

    expect(() => handler(undefined, "device-1")).toThrowError(RpcError);
    expect(() => handler(undefined, "device-1")).toThrowError("params must be an object");
    expect(closeConversation).not.toHaveBeenCalled();
  });

  it("throws INVALID_PARAMS when id is missing", () => {
    const closeConversation = vi.fn();
    const handler = createDeleteConversationHandler({ closeConversation });

    expect(() => handler({}, "device-1")).toThrowError(RpcError);
    expect(() => handler({}, "device-1")).toThrowError("Missing required param: id");
    expect(closeConversation).not.toHaveBeenCalled();
  });

  it("closes conversation when id is provided", () => {
    const closeConversation = vi.fn(() => true);
    const handler = createDeleteConversationHandler({ closeConversation });

    const result = handler({ id: "conv-1" }, "device-1") as { ok: boolean };

    expect(closeConversation).toHaveBeenCalledWith("conv-1");
    expect(result).toEqual({ ok: true });
  });
});
