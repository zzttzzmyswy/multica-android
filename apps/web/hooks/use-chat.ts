"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { v7 as uuidv7 } from "uuid";
import {
  type GatewayClient,
  type ContentBlock,
  type AgentEvent,
  type StreamPayload,
  type GetAgentMessagesResult,
  type ExecApprovalRequestPayload,
  type ApprovalDecision,
  StreamAction,
  ExecApprovalRequestAction,
} from "@multica/sdk";

export type ToolStatus = "running" | "success" | "error" | "interrupted";

export interface Message {
  id: string;
  role: "user" | "assistant" | "toolResult";
  content: ContentBlock[];
  agentId: string;
  stopReason?: string;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolStatus?: ToolStatus;
  isError?: boolean;
}

interface UseChatOptions {
  client: GatewayClient;
  hubId: string;
  agentId: string;
}

export interface ChatError {
  code: string;
  message: string;
}

export interface PendingApproval extends ExecApprovalRequestPayload {
  /** Timestamp when the request was received (for ordering) */
  receivedAt: number;
}

export interface UseChatReturn {
  messages: Message[];
  streamingIds: Set<string>;
  isLoading: boolean;
  error: ChatError | null;
  pendingApprovals: PendingApproval[];
  sendMessage: (text: string) => void;
  resolveApproval: (approvalId: string, decision: ApprovalDecision) => void;
}

function toContentBlocks(content: string | ContentBlock[]): ContentBlock[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  if (Array.isArray(content)) return content;
  return [];
}

function extractContent(event: AgentEvent): ContentBlock[] {
  if (!("message" in event)) return [];
  const msg = event.message;
  if (!msg || !("content" in msg)) return [];
  const content = msg.content;
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

export function useChat({ client, hubId, agentId }: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingIds, setStreamingIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  // Keep a ref for use inside callbacks (avoids stale closures)
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Fetch history on mount
  useEffect(() => {
    async function fetchHistory() {
      try {
        const result = await client.request<GetAgentMessagesResult>(
          hubId,
          "getAgentMessages",
          { agentId, limit: 200 },
        );

        // Build toolCallId → args lookup from assistant tool_use blocks
        const toolCallArgsMap = new Map<string, { name: string; args: Record<string, unknown> }>();
        for (const m of result.messages) {
          if (m.role === "assistant") {
            for (const block of m.content) {
              if (block.type === "toolCall") {
                toolCallArgsMap.set(block.id, { name: block.name, args: block.arguments });
              }
            }
          }
        }

        const loaded: Message[] = [];
        for (const m of result.messages) {
          if (m.role === "user") {
            loaded.push({
              id: uuidv7(),
              role: "user",
              content: toContentBlocks(m.content),
              agentId,
            });
          } else if (m.role === "assistant") {
            loaded.push({
              id: uuidv7(),
              role: "assistant",
              content: toContentBlocks(m.content),
              agentId,
              stopReason: m.stopReason,
            });
          } else if (m.role === "toolResult") {
            const callInfo = toolCallArgsMap.get(m.toolCallId);
            loaded.push({
              id: uuidv7(),
              role: "toolResult",
              content: toContentBlocks(m.content),
              agentId,
              toolCallId: m.toolCallId,
              toolName: m.toolName,
              toolArgs: callInfo?.args,
              toolStatus: m.isError ? "error" : "success",
              isError: m.isError,
            });
          }
        }

        if (loaded.length > 0) {
          setMessages(loaded);
        }
      } catch {
        // History fetch is best-effort
      }
    }

    fetchHistory();
  }, [client, hubId, agentId]);

  // Listen for streaming events
  useEffect(() => {
    client.onMessage((msg) => {
      if (msg.action === StreamAction) {
        const payload = msg.payload as StreamPayload;
        const { event } = payload;

        switch (event.type) {
          case "message_start": {
            const newMsg: Message = {
              id: payload.streamId,
              role: "assistant",
              content: [],
              agentId: payload.agentId,
            };
            const content = extractContent(event);
            if (content.length) newMsg.content = content;

            setMessages((prev) => [...prev, newMsg]);
            setStreamingIds((prev) => new Set(prev).add(payload.streamId));
            setIsLoading(true);
            break;
          }
          case "message_update": {
            const content = extractContent(event);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === payload.streamId ? { ...m, content } : m,
              ),
            );
            break;
          }
          case "message_end": {
            const content = extractContent(event);
            const stopReason =
              "message" in event
                ? (event.message as { stopReason?: string })?.stopReason
                : undefined;

            setMessages((prev) =>
              prev.map((m) => {
                if (m.id === payload.streamId) return { ...m, content, stopReason };
                // Interrupt running tools belonging to the same agent
                if (
                  m.role === "toolResult" &&
                  m.toolStatus === "running" &&
                  m.agentId === payload.agentId
                ) {
                  return { ...m, toolStatus: "interrupted" as ToolStatus };
                }
                return m;
              }),
            );
            setStreamingIds((prev) => {
              const next = new Set(prev);
              next.delete(payload.streamId);
              return next;
            });
            setIsLoading(false);
            break;
          }
          case "tool_execution_start": {
            const toolMsg: Message = {
              id: uuidv7(),
              role: "toolResult",
              content: [],
              agentId: payload.agentId,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              toolArgs: event.args as Record<string, unknown> | undefined,
              toolStatus: "running",
              isError: false,
            };
            setMessages((prev) => [...prev, toolMsg]);
            break;
          }
          case "tool_execution_end": {
            setMessages((prev) =>
              prev.map((m) =>
                m.role === "toolResult" && m.toolCallId === event.toolCallId
                  ? {
                      ...m,
                      toolStatus: (event.isError ? "error" : "success") as ToolStatus,
                      isError: event.isError ?? false,
                      content:
                        event.result != null
                          ? [
                              {
                                type: "text" as const,
                                text:
                                  typeof event.result === "string"
                                    ? event.result
                                    : JSON.stringify(event.result),
                              },
                            ]
                          : [],
                    }
                  : m,
              ),
            );
            break;
          }
          case "tool_execution_update":
            break;
        }
        return;
      }

      // Exec approval request from Hub
      if (msg.action === ExecApprovalRequestAction) {
        const payload = msg.payload as ExecApprovalRequestPayload;
        setPendingApprovals((prev) => [...prev, { ...payload, receivedAt: Date.now() }]);
        return;
      }

      // Error from Hub (e.g. UNAUTHORIZED)
      if (msg.action === "error") {
        const errPayload = msg.payload as { code: string; message: string };
        setError({ code: errPayload.code, message: errPayload.message });
        return;
      }

      // Direct (non-streaming) message
      const payload = msg.payload as { agentId?: string; content?: string };
      if (payload?.agentId && payload?.content) {
        setMessages((prev) => [
          ...prev,
          {
            id: uuidv7(),
            role: "assistant",
            content: [{ type: "text", text: payload.content! }],
            agentId: payload.agentId!,
          },
        ]);
      }
    });

    return () => {
      // Clear onMessage when unmounting
      client.onMessage(() => {});
    };
  }, [client, agentId]);

  const resolveApproval = useCallback(
    (approvalId: string, decision: ApprovalDecision) => {
      setPendingApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId));
      client.request(hubId, "resolveExecApproval", { approvalId, decision }).catch(() => {
        // Best-effort — approval may have already expired
      });
    },
    [client, hubId],
  );

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      setMessages((prev) => [
        ...prev,
        {
          id: uuidv7(),
          role: "user",
          content: [{ type: "text", text: trimmed }],
          agentId,
        },
      ]);

      client.send(hubId, "message", { agentId, content: trimmed });
      setIsLoading(true);
    },
    [client, hubId, agentId],
  );

  return { messages, streamingIds, isLoading, error, pendingApprovals, sendMessage, resolveApproval };
}
