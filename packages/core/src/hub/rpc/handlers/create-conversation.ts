import type { RpcHandler } from "../dispatcher.js";

interface HubLike {
  createConversation(id?: string): { sessionId: string };
}

export function createCreateConversationHandler(hub: HubLike): RpcHandler {
  return (params: unknown) => {
    const { id } = (params ?? {}) as { id?: string };
    const conversation = hub.createConversation(id);
    return { id: conversation.sessionId };
  };
}
