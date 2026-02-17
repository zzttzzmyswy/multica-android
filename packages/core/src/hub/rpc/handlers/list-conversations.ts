import type { RpcHandler } from "../dispatcher.js";

interface HubLike {
  listConversations(): string[];
  getConversation(id: string): { closed: boolean } | undefined;
}

export function createListConversationsHandler(hub: HubLike): RpcHandler {
  return () => {
    const conversations = hub.listConversations().map((id) => {
      const conversation = hub.getConversation(id);
      return { id, closed: conversation?.closed ?? true };
    });
    return { conversations };
  };
}
