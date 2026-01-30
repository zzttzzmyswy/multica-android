"use client";
import { useRef } from "react";
import { Button } from "@multica/ui/components/ui/button";
import { ArrowUpIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

interface ChatInputProps {
  onSubmit?: (value: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSubmit, disabled }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    const value = textareaRef.current?.value ?? "";
    if (!value.trim()) return;
    onSubmit?.(value);
    textareaRef.current!.value = "";
    // reset height
    textareaRef.current!.style.height = "auto";
  };

  return (
    <div className="bg-card rounded-xl p-3 border border-border">
      <textarea
        ref={textareaRef}
        rows={2}
        disabled={disabled}
        placeholder="Type a message..."
        onChange={(e) => {
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        className="w-full resize-none bg-transparent px-1 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
      />
      <div className="flex items-center justify-end pt-2">
        <Button size="icon" onClick={handleSubmit} disabled={disabled}>
          <HugeiconsIcon strokeWidth={2.5} icon={ArrowUpIcon} />
        </Button>
      </div>
    </div>
  );
}
