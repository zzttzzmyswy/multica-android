import type { RpcHandler } from "../dispatcher.js";

interface HubLike {
  createConversation(id?: string, options?: { agentId?: string }): { sessionId: string };
}

export function createCreateConversationHandler(hub: HubLike): RpcHandler {
  return (params: unknown) => {
    const { id, agentId } = (params ?? {}) as { id?: string; agentId?: string };
    const conversation = hub.createConversation(id, { agentId });
    return { id: conversation.sessionId };
  };
}
