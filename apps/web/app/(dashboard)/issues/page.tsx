"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import {
  Columns3,
  List,
  Plus,
  Bot,
  Circle,
  CircleDashed,
  CircleDot,
  CircleCheck,
  CircleX,
  CircleAlert,
  Eye,
  Minus,
  MessageSquare,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { IssueStatus, IssuePriority } from "@multica/types";
import {
  MOCK_ISSUES,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  type MockIssue,
  type MockAssignee,
} from "./_data/mock";

// ---------------------------------------------------------------------------
// Shared icon components
// ---------------------------------------------------------------------------

const STATUS_ICONS: Record<IssueStatus, typeof Circle> = {
  backlog: CircleDashed,
  todo: Circle,
  in_progress: CircleDot,
  in_review: Eye,
  done: CircleCheck,
  blocked: CircleAlert,
  cancelled: CircleX,
};

export function StatusIcon({
  status,
  className = "h-4 w-4",
}: {
  status: IssueStatus;
  className?: string;
}) {
  const Icon = STATUS_ICONS[status];
  const cfg = STATUS_CONFIG[status];
  return <Icon className={`${className} ${cfg.iconColor}`} />;
}

export function PriorityIcon({
  priority,
  className = "",
}: {
  priority: IssuePriority;
  className?: string;
}) {
  const cfg = PRIORITY_CONFIG[priority];
  if (cfg.bars === 0) {
    return <Minus className={`h-3.5 w-3.5 text-muted-foreground ${className}`} />;
  }
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 ${cfg.color} ${className}`}
      fill="currentColor"
    >
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={1 + i * 4}
          y={12 - (i + 1) * 3}
          width="3"
          height={(i + 1) * 3}
          rx="0.5"
          opacity={i < cfg.bars ? 1 : 0.2}
        />
      ))}
    </svg>
  );
}

function AssigneeAvatar({
  assignee,
  size = "sm",
}: {
  assignee: MockAssignee | null;
  size?: "sm" | "md";
}) {
  if (!assignee) return null;
  const sizeClass = size === "sm" ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-xs";
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-medium ${sizeClass} ${
        assignee.type === "agent"
          ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
          : "bg-muted text-muted-foreground"
      }`}
      title={assignee.name}
    >
      {assignee.type === "agent" ? (
        <Bot className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      ) : (
        assignee.avatar.charAt(0)
      )}
    </div>
  );
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Board View — Card (static, used in both draggable wrapper and overlay)
// ---------------------------------------------------------------------------

function BoardCardContent({ issue }: { issue: MockIssue }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <PriorityIcon priority={issue.priority} />
        <span>{issue.key}</span>
      </div>
      <p className="mt-1.5 text-[13px] leading-snug">{issue.title}</p>
      <div className="mt-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AssigneeAvatar assignee={issue.assignee} />
          {issue.comments.length > 0 && (
            <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
              <MessageSquare className="h-3 w-3" />
              {issue.comments.length}
            </span>
          )}
        </div>
        {issue.dueDate && (
          <span className="text-xs text-muted-foreground">
            {formatDate(issue.dueDate)}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draggable card wrapper
// ---------------------------------------------------------------------------

function DraggableBoardCard({ issue }: { issue: MockIssue }) {
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
        onClick={(e) => {
          // Prevent navigation when dragging
          if (isDragging) e.preventDefault();
        }}
        className="block transition-colors hover:opacity-80"
      >
        <BoardCardContent issue={issue} />
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Droppable column
// ---------------------------------------------------------------------------

function DroppableColumn({
  status,
  issues,
}: {
  status: IssueStatus;
  issues: MockIssue[];
}) {
  const cfg = STATUS_CONFIG[status];
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className="flex w-64 shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <StatusIcon status={status} className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">{cfg.label}</span>
        <span className="text-xs text-muted-foreground">{issues.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 space-y-1.5 overflow-y-auto rounded-lg p-1 transition-colors ${
          isOver ? "bg-accent/40" : ""
        }`}
      >
        {issues.map((issue) => (
          <DraggableBoardCard key={issue.id} issue={issue} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Board View (with DnD)
// ---------------------------------------------------------------------------

function BoardView({
  issues,
  onMoveIssue,
}: {
  issues: MockIssue[];
  onMoveIssue: (issueId: string, newStatus: IssueStatus) => void;
}) {
  const [activeIssue, setActiveIssue] = useState<MockIssue | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const visibleStatuses: IssueStatus[] = [
    "backlog",
    "todo",
    "in_progress",
    "in_review",
    "done",
  ];

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const issue = issues.find((i) => i.id === event.active.id);
      if (issue) setActiveIssue(issue);
    },
    [issues]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveIssue(null);
      const { active, over } = event;
      if (!over) return;

      const issueId = active.id as string;
      // `over.id` is the column's droppable id (a status string)
      // or another card's sortable id
      let targetStatus: IssueStatus | undefined;

      if (visibleStatuses.includes(over.id as IssueStatus)) {
        targetStatus = over.id as IssueStatus;
      } else {
        // Dropped on a card — find which column that card is in
        const targetIssue = issues.find((i) => i.id === over.id);
        if (targetIssue) targetStatus = targetIssue.status;
      }

      if (targetStatus) {
        const currentIssue = issues.find((i) => i.id === issueId);
        if (currentIssue && currentIssue.status !== targetStatus) {
          onMoveIssue(issueId, targetStatus);
        }
      }
    },
    [issues, onMoveIssue, visibleStatuses]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full gap-3 overflow-x-auto p-4">
        {visibleStatuses.map((status) => (
          <DroppableColumn
            key={status}
            status={status}
            issues={issues.filter((i) => i.status === status)}
          />
        ))}
      </div>

      <DragOverlay>
        {activeIssue ? (
          <div className="w-64 rotate-2 opacity-90 shadow-lg">
            <BoardCardContent issue={activeIssue} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ---------------------------------------------------------------------------
// List View
// ---------------------------------------------------------------------------

function ListRow({ issue }: { issue: MockIssue }) {
  return (
    <Link
      href={`/issues/${issue.id}`}
      className="flex h-9 items-center gap-2 px-4 text-[13px] transition-colors hover:bg-accent/50"
    >
      <PriorityIcon priority={issue.priority} />
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{issue.key}</span>
      <StatusIcon status={issue.status} className="h-3.5 w-3.5" />
      <span className="min-w-0 flex-1 truncate">{issue.title}</span>
      {issue.dueDate && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDate(issue.dueDate)}
        </span>
      )}
      <AssigneeAvatar assignee={issue.assignee} />
    </Link>
  );
}

function ListView({ issues }: { issues: MockIssue[] }) {
  const groupOrder: IssueStatus[] = [
    "in_review",
    "in_progress",
    "todo",
    "backlog",
    "done",
  ];

  return (
    <div className="overflow-y-auto">
      {groupOrder.map((status) => {
        const cfg = STATUS_CONFIG[status];
        const filtered = issues.filter((i) => i.status === status);
        if (filtered.length === 0) return null;
        return (
          <div key={status}>
            <div className="flex h-8 items-center gap-2 border-b px-4">
              <StatusIcon status={status} className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">{cfg.label}</span>
              <span className="text-xs text-muted-foreground">{filtered.length}</span>
            </div>
            {filtered.map((issue) => (
              <ListRow key={issue.id} issue={issue} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type ViewMode = "board" | "list";

export default function IssuesPage() {
  const [view, setView] = useState<ViewMode>("board");
  const [issues, setIssues] = useState<MockIssue[]>(MOCK_ISSUES);

  const handleMoveIssue = useCallback(
    (issueId: string, newStatus: IssueStatus) => {
      setIssues((prev) =>
        prev.map((issue) =>
          issue.id === issueId
            ? { ...issue, status: newStatus, updatedAt: new Date().toISOString() }
            : issue
        )
      );
    },
    []
  );

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold">All Issues</h1>
          <div className="ml-2 flex items-center rounded-md border p-0.5">
            <button
              onClick={() => setView("board")}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
                view === "board"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Columns3 className="h-3 w-3" />
              Board
            </button>
            <button
              onClick={() => setView("list")}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
                view === "list"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <List className="h-3 w-3" />
              List
            </button>
          </div>
        </div>
        <button className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground transition-colors hover:bg-primary/90">
          <Plus className="h-3.5 w-3.5" />
          New Issue
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {view === "board" ? (
          <BoardView issues={issues} onMoveIssue={handleMoveIssue} />
        ) : (
          <ListView issues={issues} />
        )}
      </div>
    </div>
  );
}
