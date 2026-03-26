"use client";

import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Issue } from "@/shared/types";
import { CalendarDays } from "lucide-react";
import { ActorAvatar } from "@/components/common/actor-avatar";
import { PriorityIcon } from "./priority-icon";

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function BoardCardContent({ issue }: { issue: Issue }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <PriorityIcon priority={issue.priority} />
        <span>{issue.id.slice(0, 8)}</span>
      </div>
      <p className="mt-1.5 text-sm leading-snug line-clamp-2">{issue.title}</p>
      <div className="mt-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {issue.assignee_type && issue.assignee_id && (
            <ActorAvatar
              actorType={issue.assignee_type}
              actorId={issue.assignee_id}
              size={20}
            />
          )}
        </div>
        {issue.due_date && (
          <span className={`flex items-center gap-1 text-xs ${new Date(issue.due_date) < new Date() ? "text-destructive" : "text-muted-foreground"}`}>
            <CalendarDays className="size-3" />
            {formatDate(issue.due_date)}
          </span>
        )}
      </div>
    </div>
  );
}

export function DraggableBoardCard({ issue }: { issue: Issue }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: issue.id,
    data: { status: issue.status },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={isDragging ? "opacity-30" : ""}
    >
      <Link
        href={`/issues/${issue.id}`}
        className={`block transition-colors hover:opacity-80 ${isDragging ? "pointer-events-none" : ""}`}
      >
        <BoardCardContent issue={issue} />
      </Link>
    </div>
  );
}
