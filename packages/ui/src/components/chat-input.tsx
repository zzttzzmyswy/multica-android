"use client";
import { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Button } from "@multica/ui/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@multica/ui/components/ui/hover-card";
import { ArrowUp, Gauge, Square, TriangleAlert } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";
import "./chat-input.css";

export interface ChatInputRef {
  getText: () => string;
  setText: (text: string) => void;
  focus: () => void;
  clear: () => void;
}

export interface ContextWindowUsage {
  usedTokens: number;
  totalTokens: number;
  availableTokens: number;
  usageRatio: number;
  usagePercent: number;
  isEstimated?: boolean;
  lastCompaction?: {
    removed: number;
    kept: number;
    tokensRemoved?: number;
    tokensKept?: number;
    reason: string;
  };
}

interface ChatInputProps {
  onSubmit?: (value: string) => void;
  onAbort?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Initial value to pre-fill the input */
  defaultValue?: string;
  /** Context usage stats shown in the input footer */
  contextWindowUsage?: ContextWindowUsage;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${tokens}`;
}

function resolveUsageTone(ratio: number): {
  dotClass: string;
  textClass: string;
} {
  if (ratio >= 0.9) {
    return { dotClass: "bg-destructive", textClass: "text-destructive" };
  }
  if (ratio >= 0.75) {
    return { dotClass: "bg-foreground/80", textClass: "text-foreground" };
  }
  return { dotClass: "bg-muted-foreground/60", textClass: "text-muted-foreground" };
}

function ContextWindowIndicator({ usage }: { usage: ContextWindowUsage }) {
  const ratio = Math.max(0, usage.usageRatio);
  const usagePercent = Math.max(0, usage.usagePercent);
  const clampedPercent = Math.min(100, usagePercent);
  const tone = resolveUsageTone(ratio);
  const usedTokens = formatTokenCount(usage.usedTokens);
  const totalTokens = formatTokenCount(usage.totalTokens);
  const availableTokens = formatTokenCount(Math.max(0, usage.availableTokens));
  const compactionFreed = usage.lastCompaction?.tokensRemoved;

  return (
    <HoverCard>
      <HoverCardTrigger
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 px-2 text-[11px] font-medium transition-colors hover:bg-muted/50",
          tone.textClass,
        )}
      >
        <span className={cn("size-1.5 rounded-full", tone.dotClass)} />
        <Gauge className="size-3.5" />
        <span>{clampedPercent}%</span>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-72 space-y-3 rounded-xl p-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Context window</p>
          <p className={cn("text-2xl font-semibold leading-none", ratio >= 0.9 && "text-destructive")}>
            {clampedPercent}% full
          </p>
          <p className="text-xs text-muted-foreground">
            {usedTokens} / {totalTokens} tokens used{usage.isEstimated ? " (est.)" : ""}
          </p>
        </div>

        <div className="h-1.5 overflow-hidden rounded-full bg-muted/80">
          <div
            className={cn("h-full rounded-full transition-[width]", tone.dotClass)}
            style={{ width: `${Math.min(100, Math.max(1, clampedPercent))}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{availableTokens} tokens left</span>
          <span>
            {compactionFreed != null
              ? `Last compaction: -${formatTokenCount(compactionFreed)}`
              : "Auto-compaction enabled"}
          </span>
        </div>

        {ratio > 1 && (
          <div className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" />
            <span>Context is over capacity. The next run will compact history.</span>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

export const ChatInput = forwardRef<ChatInputRef, ChatInputProps>(
  function ChatInput(
    { onSubmit, onAbort, isLoading, disabled, placeholder = "Type a message...", defaultValue, contextWindowUsage },
    ref,
  ) {
    // Use refs to avoid stale closures in Tiptap keydown handler
    const onSubmitRef = useRef(onSubmit);
    onSubmitRef.current = onSubmit;
    const editorRef = useRef<Editor | null>(null);

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          // Disable all rich-text features — plain text only
          heading: false,
          bold: false,
          italic: false,
          strike: false,
          code: false,
          codeBlock: false,
          blockquote: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          horizontalRule: false,
        }),
        Placeholder.configure({ placeholder }),
      ],
      content: defaultValue ? `<p>${defaultValue}</p>` : "",
      immediatelyRender: false,
      // Scroll cursor into view on every content change (e.g., Shift+Enter newlines)
      onUpdate({ editor }) {
        editor.commands.scrollIntoView();
      },
      editorProps: {
        attributes: {
          class:
            "w-full resize-none bg-transparent px-1 py-1 text-base text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
        },
        // Ensure cursor scrolls into view when typing near container edges
        scrollThreshold: 20,
        scrollMargin: 20,
        handleKeyDown(_view, event) {
          // Guard for IME composition (Chinese/Japanese input)
          if (event.isComposing) return false;

          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            // Use TipTap's getText API to preserve newlines between paragraphs
            const text = editorRef.current?.getText({ blockSeparator: '\n' }) ?? '';
            if (!text.trim()) return true;
            onSubmitRef.current?.(text);
            editorRef.current?.commands.clearContent();
            return true;
          }

          return false;
        },
      },
    });

    // Keep editorRef in sync for use in handleKeyDown closure
    editorRef.current = editor;

    // Sync disabled state
    useEffect(() => {
      if (!editor) return;
      editor.setEditable(!disabled);
    }, [editor, disabled]);

    // Sync placeholder
    useEffect(() => {
      if (!editor) return;
      editor.extensionManager.extensions.find(
        (ext) => ext.name === "placeholder",
      )!.options.placeholder = placeholder;
      // Force view update so placeholder re-renders
      editor.view.dispatch(editor.state.tr);
    }, [editor, placeholder]);

    // Expose imperative API
    useImperativeHandle(ref, () => ({
      getText: () => editor?.getText({ blockSeparator: '\n' }) ?? "",
      setText: (text: string) => {
        editor?.commands.setContent(text ? `<p>${text}</p>` : "");
      },
      focus: () => editor?.commands.focus(),
      clear: () => editor?.commands.clearContent(),
    }), [editor]);

    const handleSubmit = () => {
      if (!editor) return;
      // Use TipTap's getText API to preserve newlines between paragraphs
      const text = editor.getText({ blockSeparator: '\n' });
      if (!text.trim()) return;
      onSubmit?.(text);
      editor.commands.clearContent();
    };

    const handleButtonClick = () => {
      if (isLoading && onAbort) {
        onAbort();
      } else {
        handleSubmit();
      }
    };

    const showStop = isLoading && !!onAbort;

    return (
      <div className={cn(
        "chat-input-editor bg-card rounded-xl p-2 border border-border transition-colors",
        disabled && "is-disabled cursor-not-allowed opacity-60",
      )}>
        <EditorContent className="min-h-12" editor={editor} />
        <div className="flex items-center justify-between gap-2 pt-2">
          {contextWindowUsage ? (
            <ContextWindowIndicator usage={contextWindowUsage} />
          ) : (
            <div />
          )}
          <Button size="icon" onClick={handleButtonClick} disabled={disabled && !showStop}>
            {showStop ? <Square className="size-4 fill-current" /> : <ArrowUp />}
          </Button>
        </div>
      </div>
    );
  },
);
