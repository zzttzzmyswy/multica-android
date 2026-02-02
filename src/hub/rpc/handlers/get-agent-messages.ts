import { existsSync } from "fs";
import { SessionManager } from "../../../agent/session/session-manager.js";
import { resolveSessionPath } from "../../../agent/session/storage.js";
import { RpcError, type RpcHandler } from "../dispatcher.js";

interface GetAgentMessagesParams {
  agentId: string;
  offset?: number;
  limit?: number;
}

export function createGetAgentMessagesHandler(): RpcHandler {
  return (params: unknown) => {
    if (!params || typeof params !== "object") {
      throw new RpcError("INVALID_PARAMS", "params must be an object");
    }
    const { agentId, offset = 0, limit = 50 } = params as GetAgentMessagesParams;
    if (!agentId) {
      throw new RpcError("INVALID_PARAMS", "Missing required param: agentId");
    }

    const sessionPath = resolveSessionPath(agentId);
    if (!existsSync(sessionPath)) {
      throw new RpcError("AGENT_NOT_FOUND", `No session found for agent: ${agentId}`);
    }

    const session = new SessionManager({ sessionId: agentId });
    const allMessages = session.loadMessages();
    const total = allMessages.length;
    const sliced = allMessages.slice(offset, offset + limit);

    return { messages: sliced, total, offset, limit };
  };
}
