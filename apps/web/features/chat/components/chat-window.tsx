"use client";

import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useWorkspaceId } from "@core/hooks";
import { agentListOptions } from "@core/workspace/queries";
import { chatMessagesOptions, chatKeys } from "@core/chat/queries";
import {
  useCreateChatSession,
  useSendChatMessage,
} from "@core/chat/mutations";
import { useChatStore } from "../store";
import { ChatMessageList } from "./chat-message-list";
import { ChatInput } from "./chat-input";
import { useWS } from "@/features/realtime";
import type { TaskMessagePayload, ChatDonePayload } from "@/shared/types";

export function ChatWindow() {
  const wsId = useWorkspaceId();
  const isOpen = useChatStore((s) => s.isOpen);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const pendingTaskId = useChatStore((s) => s.pendingTaskId);
  const streamingContent = useChatStore((s) => s.streamingContent);
  const setOpen = useChatStore((s) => s.setOpen);
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const setPendingTask = useChatStore((s) => s.setPendingTask);
  const appendStreaming = useChatStore((s) => s.appendStreamingContent);
  const clearStreaming = useChatStore((s) => s.clearStreamingContent);

  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: messages = [] } = useQuery(
    chatMessagesOptions(activeSessionId ?? ""),
  );

  const qc = useQueryClient();
  const createSession = useCreateChatSession();
  const sendMessage = useSendChatMessage(activeSessionId ?? "");

  // Pick the first non-archived agent as default chat target.
  const defaultAgent = agents.find((a) => !a.archived_at) ?? null;
  const activeAgent = activeSessionId
    ? agents.find((a) =>
        messages.length > 0
          ? true // we'll match by session later
          : a.id === defaultAgent?.id,
      ) ?? defaultAgent
    : defaultAgent;

  // Subscribe to task:message for streaming.
  const { subscribe } = useWS();

  useEffect(() => {
    if (!pendingTaskId) return;

    const unsubMessage = subscribe("task:message", (payload) => {
      const p = payload as TaskMessagePayload;
      if (p.task_id !== pendingTaskId) return;
      if (p.type === "text" && p.content) {
        appendStreaming(p.content);
      }
    });

    const unsubDone = subscribe("chat:done", (payload) => {
      const p = payload as ChatDonePayload;
      if (p.task_id !== pendingTaskId) return;
      // Agent finished — save the streamed content as an assistant message.
      const content = useChatStore.getState().streamingContent;
      if (content && activeSessionId) {
        qc.invalidateQueries({
          queryKey: chatKeys.messages(activeSessionId),
        });
      }
      clearStreaming();
      setPendingTask(null);
    });

    // Also listen for task:completed / task:failed as fallback.
    const unsubCompleted = subscribe("task:completed", (payload) => {
      const p = payload as { task_id: string };
      if (p.task_id !== pendingTaskId) return;
      if (activeSessionId) {
        qc.invalidateQueries({
          queryKey: chatKeys.messages(activeSessionId),
        });
      }
      clearStreaming();
      setPendingTask(null);
    });

    const unsubFailed = subscribe("task:failed", (payload) => {
      const p = payload as { task_id: string };
      if (p.task_id !== pendingTaskId) return;
      clearStreaming();
      setPendingTask(null);
    });

    return () => {
      unsubMessage();
      unsubDone();
      unsubCompleted();
      unsubFailed();
    };
  }, [
    pendingTaskId,
    activeSessionId,
    subscribe,
    appendStreaming,
    clearStreaming,
    setPendingTask,
    qc,
  ]);

  const handleSend = useCallback(
    async (content: string) => {
      if (!defaultAgent) return;

      let sessionId = activeSessionId;

      // Create session if none exists.
      if (!sessionId) {
        const session = await createSession.mutateAsync({
          agent_id: defaultAgent.id,
          title: content.slice(0, 50),
        });
        sessionId = session.id;
        setActiveSession(sessionId);
      }

      // Need to update the mutation's sessionId — we'll use a direct API call
      // since useSendChatMessage is bound to the initial sessionId.
      const { task_id } = await (await import("@/shared/api")).api.sendChatMessage(
        sessionId,
        content,
      );
      // Optimistic add.
      qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
      setPendingTask(task_id);
      clearStreaming();
    },
    [
      activeSessionId,
      defaultAgent,
      createSession,
      setActiveSession,
      setPendingTask,
      clearStreaming,
      qc,
    ],
  );

  if (!isOpen) return null;

  return (
    <Card className="fixed bottom-20 right-6 z-50 flex flex-col w-96 h-[500px] shadow-xl border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-purple-600" />
          <span className="text-sm font-medium">
            {activeAgent?.name ?? "Chat"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setOpen(false)}
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Messages */}
      <ChatMessageList
        messages={messages}
        agent={activeAgent}
        streamingContent={streamingContent}
        isWaiting={!!pendingTaskId}
      />

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={!!pendingTaskId} />
    </Card>
  );
}
