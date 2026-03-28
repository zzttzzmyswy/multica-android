"use client";

import { useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichTextEditor, type RichTextEditorRef } from "@/components/common/rich-text-editor";
import { ActorAvatar } from "@/components/common/actor-avatar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReplyInputProps {
  placeholder?: string;
  avatarType: string;
  avatarId: string;
  onSubmit: (content: string) => Promise<void>;
  size?: "sm" | "default";
}

// ---------------------------------------------------------------------------
// ReplyInput
// ---------------------------------------------------------------------------

function ReplyInput({
  placeholder = "Leave a reply...",
  avatarType,
  avatarId,
  onSubmit,
  size = "default",
}: ReplyInputProps) {
  const editorRef = useRef<RichTextEditorRef>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const content = editorRef.current?.getMarkdown()?.trim();
    if (!content || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(content);
      editorRef.current?.clearContent();
      setIsEmpty(true);
    } finally {
      setSubmitting(false);
    }
  };

  const avatarSize = size === "sm" ? 22 : 28;

  return (
    <div className="flex items-center gap-2.5">
      <ActorAvatar
        actorType={avatarType}
        actorId={avatarId}
        size={avatarSize}
        className="shrink-0"
      />
      <div
        className={`min-w-0 flex-1 overflow-y-auto ${
          size === "sm" ? "max-h-32" : "max-h-48"
        }`}
      >
        <RichTextEditor
          ref={editorRef}
          placeholder={placeholder}
          onUpdate={(md) => setIsEmpty(!md.trim())}
          onSubmit={handleSubmit}
          debounceMs={100}
        />
      </div>
      <Button
        size="icon-xs"
        variant="ghost"
        disabled={isEmpty || submitting}
        onClick={handleSubmit}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export { ReplyInput, type ReplyInputProps };
