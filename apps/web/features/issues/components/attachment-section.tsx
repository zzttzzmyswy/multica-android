"use client";

import { useState } from "react";
import { Paperclip, FileText, Trash2, Download } from "lucide-react";
import type { Attachment } from "@/shared/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isImageType(contentType: string): boolean {
  return contentType.startsWith("image/");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AttachmentSectionProps {
  attachments: Attachment[];
  onDelete?: (id: string) => void;
  deleting?: boolean;
}

// ---------------------------------------------------------------------------
// ImageThumbnail — shows delete confirmation overlay on click
// ---------------------------------------------------------------------------

function ImageThumbnail({
  attachment,
  onDelete,
  deleting,
}: {
  attachment: Attachment;
  onDelete?: (id: string) => void;
  deleting?: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative aspect-square overflow-hidden rounded-md border border-border bg-accent/10"
      onClick={(e) => {
        if (confirmDelete) e.preventDefault();
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={attachment.url}
        alt={attachment.filename}
        className="h-full w-full object-cover"
      />

      {/* Hover overlay with delete button */}
      {!confirmDelete && onDelete && (
        <div className="absolute inset-0 flex items-end justify-end bg-black/0 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            className="m-1.5 flex h-6 w-6 items-center justify-center rounded bg-background/80 text-destructive hover:bg-background transition-colors"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setConfirmDelete(true);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Delete confirmation overlay */}
      {confirmDelete && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-sm text-white">
          <span>Delete?</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={deleting}
              className="rounded px-2 py-0.5 text-xs font-medium bg-destructive text-white hover:bg-destructive/90 transition-colors disabled:opacity-50"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete?.(attachment.id);
              }}
            >
              Yes
            </button>
            <button
              type="button"
              className="rounded px-2 py-0.5 text-xs font-medium bg-background/80 text-foreground hover:bg-background transition-colors"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setConfirmDelete(false);
              }}
            >
              No
            </button>
          </div>
        </div>
      )}
    </a>
  );
}

// ---------------------------------------------------------------------------
// FileCard — non-image attachment with download + delete on hover
// ---------------------------------------------------------------------------

function FileCard({
  attachment,
  onDelete,
  deleting,
}: {
  attachment: Attachment;
  onDelete?: (id: string) => void;
  deleting?: boolean;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md border border-border bg-accent/10 px-3 py-2 transition-colors hover:bg-accent">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{attachment.filename}</p>
        <p className="text-xs text-muted-foreground">
          {formatFileSize(attachment.size_bytes)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <a
          href={attachment.download_url}
          download={attachment.filename}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <Download className="h-3.5 w-3.5" />
        </a>
        {onDelete && (
          <button
            type="button"
            disabled={deleting}
            className="flex h-6 w-6 items-center justify-center rounded text-destructive hover:bg-accent transition-colors disabled:opacity-50"
            onClick={() => onDelete(attachment.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AttachmentSection
// ---------------------------------------------------------------------------

export function AttachmentSection({
  attachments,
  onDelete,
  deleting,
}: AttachmentSectionProps) {
  if (attachments.length === 0) return null;

  const images = attachments.filter((a) => isImageType(a.content_type));
  const files = attachments.filter((a) => !isImageType(a.content_type));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <Paperclip className="h-4 w-4" />
        <span>Attachments ({attachments.length})</span>
      </div>

      {/* Image grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {images.map((a) => (
            <ImageThumbnail
              key={a.id}
              attachment={a}
              onDelete={onDelete}
              deleting={deleting}
            />
          ))}
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div className="flex flex-col gap-2">
          {files.map((a) => (
            <FileCard
              key={a.id}
              attachment={a}
              onDelete={onDelete}
              deleting={deleting}
            />
          ))}
        </div>
      )}
    </div>
  );
}
