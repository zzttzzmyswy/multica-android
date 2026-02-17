import { existsSync } from "fs";
import { SessionManager } from "../../../agent/session/session-manager.js";
import { resolveSessionPath } from "../../../agent/session/storage.js";
import { RpcError, type RpcHandler } from "../dispatcher.js";

// Must match DEFAULT_MESSAGES_LIMIT from @multica/sdk/actions/rpc
const DEFAULT_LIMIT = 200;

interface GetAgentMessagesParams {
  agentId: string;
  conversationId: string;
  offset?: number;
  limit?: number;
}

interface ResolvedConversation {
  conversationId: string;
  storageAgentId?: string;
}

type ConversationResolver = (agentId: string, conversationId: string) => ResolvedConversation | null;

export function createGetAgentMessagesHandler(resolveConversationId?: ConversationResolver): RpcHandler {
  return (params: unknown) => {
    if (!params || typeof params !== "object") {
      throw new RpcError("INVALID_PARAMS", "params must be an object");
    }
    const { agentId, conversationId, limit = DEFAULT_LIMIT } = params as GetAgentMessagesParams;
    let { offset } = params as GetAgentMessagesParams;
    if (!agentId) {
      throw new RpcError("INVALID_PARAMS", "Missing required param: agentId");
    }
    const normalizedConversationId = (conversationId ?? "").trim();
    if (!normalizedConversationId) {
      throw new RpcError("INVALID_PARAMS", "Missing required param: conversationId");
    }
    const resolved = resolveConversationId
      ? resolveConversationId(agentId, conversationId)
      : { conversationId: normalizedConversationId };

    const resolvedConversationId = resolved?.conversationId?.trim() ?? "";
    if (!resolvedConversationId) {
      throw new RpcError("INVALID_PARAMS", "Unable to resolve conversationId");
    }

    const storageOptions = resolved?.storageAgentId
      ? { agentId: resolved.storageAgentId }
      : undefined;

    const sessionPath = resolveSessionPath(resolvedConversationId, storageOptions);
    if (!existsSync(sessionPath)) {
      throw new RpcError("AGENT_NOT_FOUND", `No session found for conversation: ${resolvedConversationId}`);
    }

    const session = new SessionManager({
      sessionId: resolvedConversationId,
      ...(storageOptions ?? {}),
    });
    const allMessages = session.loadMessagesForDisplay();
    const total = allMessages.length;
    const contextWindowTokens = session.getMeta()?.contextWindowTokens ?? session.getContextWindowTokens();

    // When offset is not provided, return the latest messages
    if (offset == null) {
      offset = Math.max(0, total - limit);
    }

    const sliced = allMessages.slice(offset, offset + limit);

    return { messages: sliced, total, offset, limit, conversationId: resolvedConversationId, contextWindowTokens };
  };
}
