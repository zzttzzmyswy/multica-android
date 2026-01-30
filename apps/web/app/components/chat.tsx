"use client";

import { useRef, useState, useCallback } from "react";
import { SidebarTrigger } from "@multica/ui/components/ui/sidebar";
import { Button } from "@multica/ui/components/ui/button";
import { ChatInput } from "@multica/ui/components/chat-input";
import { MemoizedMarkdown } from "@multica/ui/components/markdown";
import { useMessages } from "../hooks/use-messages";
import { useDeviceId } from "../hooks/use-device-id";
import { useScrollFade } from "../hooks/use-scroll-fade";
import { cn } from "@multica/ui/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { toast } from "@multica/ui/components/ui/sonner";

export function Chat() {
  const deviceId = useDeviceId();
  const messages = useMessages();
  const mainRef = useRef<HTMLElement>(null);
  const fadeStyle = useScrollFade(mainRef);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!deviceId) return;
    await navigator.clipboard.writeText(deviceId);
    setCopied(true);
    toast.success("Device ID copied");
    setTimeout(() => setCopied(false), 2000);
  }, [deviceId]);

  return (
    <div className="h-dvh flex flex-col overflow-hidden w-full">
      <header className="flex items-center gap-2 p-2">
        <SidebarTrigger />
        <span className="text-xs text-muted-foreground font-mono">
          {deviceId || "\u00A0"}
        </span>
        {deviceId && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleCopy}
            aria-label="Copy device ID"
          >
            <HugeiconsIcon
              icon={copied ? CheckmarkCircle02Icon : Copy01Icon}
              strokeWidth={2}
              className={cn("size-3", copied && "text-green-500")}
            />
          </Button>
        )}
      </header>

      <main ref={mainRef} className="flex-1 overflow-y-auto min-h-0" style={fadeStyle}>
        <div className="px-4 py-6 space-y-6 max-w-4xl mx-auto">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-3",
                  msg.role === "user"
                    ? "bg-muted"
                    : ""
                )}
              >
                <MemoizedMarkdown mode="minimal" id={msg.id}>
                  {msg.content}
                </MemoizedMarkdown>
              </div>
            </div>
          ))}
        </div>
      </main>

      <footer className="w-full p-2 pt-1 max-w-4xl mx-auto">
        <ChatInput />
      </footer>
    </div>
  );
}
