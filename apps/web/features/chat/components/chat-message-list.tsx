"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Bot, Loader2 } from "lucide-react";
import type { ChatMessage } from "@/shared/types";
import type { Agent } from "@/shared/types";

interface ChatMessageListProps {
  messages: ChatMessage[];
  agent: Agent | null;
  streamingContent: string;
  isWaiting: boolean;
}

export function ChatMessageList({
  messages,
  agent,
  streamingContent,
  isWaiting,
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} agent={agent} />
      ))}
      {streamingContent && (
        <div className="flex items-start gap-2">
          <AgentAvatar agent={agent} />
          <div className="rounded-lg bg-muted px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap">
            {streamingContent}
          </div>
        </div>
      )}
      {isWaiting && !streamingContent && (
        <div className="flex items-start gap-2">
          <AgentAvatar agent={agent} />
          <div className="rounded-lg bg-muted px-3 py-2 text-sm">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

function MessageBubble({
  message,
  agent,
}: {
  message: ChatMessage;
  agent: Agent | null;
}) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn("flex items-start gap-2", isUser && "flex-row-reverse")}
    >
      {!isUser && <AgentAvatar agent={agent} />}
      <div
        className={cn(
          "rounded-lg px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted",
        )}
      >
        {message.content}
      </div>
    </div>
  );
}

function AgentAvatar({ agent }: { agent: Agent | null }) {
  return (
    <Avatar className="size-7 shrink-0">
      {agent?.avatar_url && <AvatarImage src={agent.avatar_url} />}
      <AvatarFallback className="bg-purple-100 text-purple-700">
        <Bot className="size-3.5" />
      </AvatarFallback>
    </Avatar>
  );
}
