"use client";

import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Issue } from "@/shared/types";
import { CalendarDays } from "lucide-react";
import { ActorAvatar } from "@/components/common/actor-avatar";
import { PriorityIcon } from "./priority-icon";
import { PRIORITY_CONFIG } from "@/features/issues/config";
import { useIssueViewStore, type CardProperties } from "@/features/issues/stores/view-store";

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function BoardCardContent({
  issue,
  cardProperties,
}: {
  issue: Issue;
  cardProperties?: CardProperties;
}) {
  const storeProperties = useIssueViewStore((s) => s.cardProperties);
  const props = cardProperties ?? storeProperties;
  const priorityCfg = PRIORITY_CONFIG[issue.priority];

  const showPriority = props.priority;
  const showDescription = props.description && issue.description;
  const showAssignee = props.assignee && issue.assignee_type && issue.assignee_id;
  const showDueDate = props.dueDate && issue.due_date;
  const showBottom = showAssignee || showDueDate;

  return (
    <div className="rounded-lg border bg-card p-3.5 shadow-[0_1px_2px_0_rgba(0,0,0,0.03)]">
      {/* Priority + label */}
      {showPriority && (
        <div className="flex items-center gap-1.5">
          <PriorityIcon priority={issue.priority} />
          <span className={`text-xs font-medium ${priorityCfg.color}`}>
            {priorityCfg.label}
          </span>
        </div>
      )}

      {/* Title */}
      <p className={`text-sm font-medium leading-snug line-clamp-2 ${showPriority ? "mt-2" : ""}`}>
        {issue.title}
      </p>

      {/* Description */}
      {showDescription && (
        <p className="mt-1 text-xs text-muted-foreground line-clamp-1">
          {issue.description}
        </p>
      )}

      {/* Bottom: avatar + date */}
      {showBottom && (
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center">
            {showAssignee && (
              <ActorAvatar
                actorType={issue.assignee_type!}
                actorId={issue.assignee_id!}
                size={22}
              />
            )}
          </div>
          {showDueDate && (
            <span
              className={`flex items-center gap-1 text-xs ${
                new Date(issue.due_date!) < new Date()
                  ? "text-destructive"
                  : "text-muted-foreground"
              }`}
            >
              <CalendarDays className="size-3" />
              {formatDate(issue.due_date!)}
            </span>
          )}
        </div>
      )}
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
