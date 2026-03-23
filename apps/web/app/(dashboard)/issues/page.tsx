"use client";

import { useState, useCallback, useEffect } from "react";
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
import type { Issue, IssueStatus, IssuePriority } from "@multica/types";
import { STATUS_CONFIG, PRIORITY_CONFIG } from "./_data/config";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import { useWSEvent } from "../../../lib/ws-context";
import type { IssueCreatedPayload, IssueUpdatedPayload, IssueDeletedPayload } from "@multica/types";

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
  issue,
  size = "sm",
}: {
  issue: Issue;
  size?: "sm" | "md";
}) {
  const { getActorName, getActorInitials } = useAuth();
  if (!issue.assignee_type || !issue.assignee_id) return null;
  const name = getActorName(issue.assignee_type, issue.assignee_id);
  const initials = getActorInitials(issue.assignee_type, issue.assignee_id);
  const sizeClass = size === "sm" ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-xs";
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-medium ${sizeClass} ${
        issue.assignee_type === "agent"
          ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
          : "bg-muted text-muted-foreground"
      }`}
      title={name}
    >
      {issue.assignee_type === "agent" ? (
        <Bot className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      ) : (
        initials
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
// Board View — Card
// ---------------------------------------------------------------------------

function BoardCardContent({ issue }: { issue: Issue }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <PriorityIcon priority={issue.priority} />
        <span>{issue.id.slice(0, 8)}</span>
      </div>
      <p className="mt-1.5 text-[13px] leading-snug">{issue.title}</p>
      <div className="mt-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AssigneeAvatar issue={issue} />
        </div>
        {issue.due_date && (
          <span className="text-xs text-muted-foreground">
            {formatDate(issue.due_date)}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draggable card wrapper
// ---------------------------------------------------------------------------

function DraggableBoardCard({ issue }: { issue: Issue }) {
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
  issues: Issue[];
}) {
  const cfg = STATUS_CONFIG[status];
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className="flex min-w-52 flex-1 flex-col">
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
  issues: Issue[];
  onMoveIssue: (issueId: string, newStatus: IssueStatus) => void;
}) {
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);

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
      let targetStatus: IssueStatus | undefined;

      if (visibleStatuses.includes(over.id as IssueStatus)) {
        targetStatus = over.id as IssueStatus;
      } else {
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

function ListRow({ issue }: { issue: Issue }) {
  return (
    <Link
      href={`/issues/${issue.id}`}
      className="flex h-9 items-center gap-2 px-4 text-[13px] transition-colors hover:bg-accent/50"
    >
      <PriorityIcon priority={issue.priority} />
      <span className="w-16 shrink-0 text-xs text-muted-foreground">
        {issue.id.slice(0, 8)}
      </span>
      <StatusIcon status={issue.status} className="h-3.5 w-3.5" />
      <span className="min-w-0 flex-1 truncate">{issue.title}</span>
      {issue.due_date && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDate(issue.due_date)}
        </span>
      )}
      <AssigneeAvatar issue={issue} />
    </Link>
  );
}

function ListView({ issues }: { issues: Issue[] }) {
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
// Create Issue Dialog (simple inline)
// ---------------------------------------------------------------------------

function CreateIssueForm({ onCreated }: { onCreated: (issue: Issue) => void }) {
  const [title, setTitle] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      const issue = await api.createIssue({ title: title.trim() });
      onCreated(issue);
      setTitle("");
      setIsOpen(false);
    } catch (err) {
      console.error("Failed to create issue:", err);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Plus className="h-3.5 w-3.5" />
        New Issue
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        autoFocus
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setIsOpen(false);
        }}
        placeholder="Issue title..."
        className="rounded-md border bg-background px-2 py-1 text-xs w-48"
      />
      <button
        type="submit"
        className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground"
      >
        Create
      </button>
      <button
        type="button"
        onClick={() => setIsOpen(false)}
        className="text-xs text-muted-foreground"
      >
        Cancel
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type ViewMode = "board" | "list";

export default function IssuesPage() {
  const [view, setView] = useState<ViewMode>("board");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listIssues({ limit: 200 })
      .then((res) => {
        setIssues(res.issues);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Real-time updates
  useWSEvent(
    "issue:created",
    useCallback((payload: unknown) => {
      const { issue } = payload as IssueCreatedPayload;
      setIssues((prev) => {
        if (prev.some((i) => i.id === issue.id)) return prev;
        return [...prev, issue];
      });
    }, []),
  );

  useWSEvent(
    "issue:updated",
    useCallback((payload: unknown) => {
      const { issue } = payload as IssueUpdatedPayload;
      setIssues((prev) => prev.map((i) => (i.id === issue.id ? issue : i)));
    }, []),
  );

  useWSEvent(
    "issue:deleted",
    useCallback((payload: unknown) => {
      const { issue_id } = payload as IssueDeletedPayload;
      setIssues((prev) => prev.filter((i) => i.id !== issue_id));
    }, []),
  );

  const handleMoveIssue = useCallback(
    (issueId: string, newStatus: IssueStatus) => {
      // Optimistic update
      setIssues((prev) =>
        prev.map((issue) =>
          issue.id === issueId ? { ...issue, status: newStatus } : issue
        )
      );

      // Persist to API
      api.updateIssue(issueId, { status: newStatus }).catch((err) => {
        console.error("Failed to update issue:", err);
        // Revert on error
        api.listIssues({ limit: 200 }).then((res) => setIssues(res.issues));
      });
    },
    []
  );

  const handleIssueCreated = useCallback((issue: Issue) => {
    setIssues((prev) => {
      if (prev.some((i) => i.id === issue.id)) return prev;
      return [...prev, issue];
    });
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

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
        <CreateIssueForm onCreated={handleIssueCreated} />
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
