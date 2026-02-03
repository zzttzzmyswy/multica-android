"use client";

import { useRef, useCallback, useMemo } from "react";
import { ChatInput } from "@multica/ui/components/chat-input";
import { MemoizedMarkdown } from "@multica/ui/components/markdown";
import { StreamingMarkdown } from "@multica/ui/components/markdown/StreamingMarkdown";
import { HugeiconsIcon } from "@hugeicons/react";
import { UserIcon } from "@hugeicons/core-free-icons";
import { useHubStore, useMessagesStore, useGatewayStore } from "@multica/store";
import { useScrollFade } from "@multica/ui/hooks/use-scroll-fade";
import { useAutoScroll } from "@multica/ui/hooks/use-auto-scroll";
import { cn } from "@multica/ui/lib/utils";

export function Chat() {
  const activeAgentId = useHubStore((s) => s.activeAgentId)
  const gwState = useGatewayStore((s) => s.connectionState)

  const messages = useMessagesStore((s) => s.messages)
  const streamingIds = useMessagesStore((s) => s.streamingIds)
  const filtered = useMemo(() => messages.filter(m => m.agentId === activeAgentId), [messages, activeAgentId])

  const handleSend = useCallback((text: string) => {
    const { hubId } = useGatewayStore.getState()
    const agentId = useHubStore.getState().activeAgentId
    if (!hubId || !agentId) return
    useMessagesStore.getState().addUserMessage(text, agentId)
    useGatewayStore.getState().send(hubId, "message", { agentId, content: text })
  }, [])

  const canSend = gwState === "registered" && !!activeAgentId

  const mainRef = useRef<HTMLElement>(null)
  const fadeStyle = useScrollFade(mainRef)
  useAutoScroll(mainRef)

  return (
    <div className="h-dvh flex flex-col overflow-hidden w-full">
      <main ref={mainRef} className="flex-1 overflow-y-auto min-h-0" style={fadeStyle}>
        {!activeAgentId ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <HugeiconsIcon icon={UserIcon} strokeWidth={1.5} className="size-10 opacity-30" />
            <span className="text-sm">Paste a connection code to start</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Send a message to start the conversation
          </div>
        ) : (
          <div className="px-4 py-6 space-y-6 max-w-4xl mx-auto">
            {filtered.map((msg) => {
              const isStreaming = streamingIds.has(msg.id)
              return (
                <div
                  key={msg.id}
                  className={cn(
                    "flex",
                    msg.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      msg.role === "user" ? "bg-muted rounded-md max-w-[60%] p-1 px-2.5" : "w-full p-1 px-2.5"
                    )}
                  >
                    {isStreaming ? (
                      <StreamingMarkdown content={msg.content} isStreaming={true} mode="minimal" />
                    ) : (
                      <MemoizedMarkdown mode="minimal" id={msg.id}>
                        {msg.content}
                      </MemoizedMarkdown>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      <footer className="w-full p-2 pt-1 max-w-4xl mx-auto">
        <ChatInput
          onSubmit={handleSend}
          disabled={!canSend}
          placeholder={!activeAgentId ? "Paste a connection code first..." : "Type a message..."}
        />
      </footer>
    </div>
  );
}
