"use client";

import { useRef } from "react";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UploadResult } from "@/shared/hooks/use-file-upload";

interface FileUploadButtonProps {
  onUpload: (file: File) => Promise<UploadResult | null>;
  onInsert?: (result: UploadResult, isImage: boolean) => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default";
}

function FileUploadButton({
  onUpload,
  onInsert,
  disabled,
  className,
  size = "default",
}: FileUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const result = await onUpload(file);
    if (result && onInsert) {
      onInsert(result, file.type.startsWith("image/"));
    }
  };

  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const btnSize = size === "sm" ? "h-6 w-6" : "h-7 w-7";

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none",
          btnSize,
          className,
        )}
      >
        <Paperclip className={iconSize} />
      </button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={handleChange}
      />
    </>
  );
}

export { FileUploadButton, type FileUploadButtonProps };
