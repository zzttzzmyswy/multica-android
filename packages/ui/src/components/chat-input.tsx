"use client";
import { useRef } from "react";
import { Button } from "@multica/ui/components/ui/button";
import { ArrowUpIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@multica/ui/lib/utils";

interface ChatInputProps {
  onSubmit?: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSubmit, disabled, placeholder = "Type a message..." }: ChatInputProps) {
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
    <div className={cn(
      "bg-card rounded-xl p-3 border border-border transition-colors",
      disabled && "cursor-not-allowed opacity-60"
    )}>
      <textarea
        ref={textareaRef}
        rows={2}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        className="w-full resize-none bg-transparent px-1 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
      <div className="flex items-center justify-end pt-2">
        <Button size="icon" onClick={handleSubmit} disabled={disabled}>
          <HugeiconsIcon strokeWidth={2.5} icon={ArrowUpIcon} />
        </Button>
      </div>
    </div>
  );
}
