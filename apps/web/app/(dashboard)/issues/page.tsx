"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Columns3,
  List,
  Plus,
  Bot,
  Calendar,
} from "lucide-react";
import type { IssueStatus, IssuePriority } from "@multica/types";
import {
  MOCK_ISSUES,
  STATUS_ORDER,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  type MockIssue,
  type MockAssignee,
} from "./_data/mock";

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function PriorityBadge({ priority }: { priority: IssuePriority }) {
  const cfg = PRIORITY_CONFIG[priority];
  return (
    <span className={`shrink-0 text-xs font-medium ${cfg.color}`}>
      {cfg.shortLabel}
    </span>
  );
}

function AssigneeAvatar({ assignee }: { assignee: MockAssignee | null }) {
  if (!assignee) return null;
  return (
    <div
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
        assignee.type === "agent"
          ? "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
          : "bg-muted text-muted-foreground"
      }`}
      title={assignee.name}
    >
      {assignee.type === "agent" ? (
        <Bot className="h-3 w-3" />
      ) : (
        assignee.avatar.charAt(0)
      )}
    </div>
  );
}

function StatusDot({ status }: { status: IssueStatus }) {
  const cfg = STATUS_CONFIG[status];
  return <span className={`h-2 w-2 shrink-0 rounded-full ${cfg.dotColor}`} />;
}

function formatDueDate(date: string | null): string | null {
  if (!date) return null;
  const d = new Date(date);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Board View
// ---------------------------------------------------------------------------

function BoardCard({ issue }: { issue: MockIssue }) {
  const due = formatDueDate(issue.dueDate);
  const isOverdue =
    issue.dueDate && new Date(issue.dueDate) < new Date() && issue.status !== "done";

  return (
    <Link
      href={`/issues/${issue.id}`}
      className="block rounded-lg border bg-background p-3 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-start gap-2">
        <PriorityBadge priority={issue.priority} />
        <span className="text-xs text-muted-foreground">{issue.key}</span>
      </div>
      <p className="mt-1.5 text-sm font-medium leading-snug">{issue.title}</p>
      <div className="mt-3 flex items-center gap-2">
        <AssigneeAvatar assignee={issue.assignee} />
        {due && (
          <span
            className={`flex items-center gap-1 text-xs ${
              isOverdue ? "text-red-500" : "text-muted-foreground"
            }`}
          >
            <Calendar className="h-3 w-3" />
            {due}
          </span>
        )}
        {issue.comments.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            {issue.comments.length} 💬
          </span>
        )}
      </div>
    </Link>
  );
}

function BoardView() {
  const visibleStatuses: IssueStatus[] = [
    "backlog",
    "todo",
    "in_progress",
    "in_review",
    "done",
  ];

  return (
    <div className="flex h-full gap-4 overflow-x-auto p-4">
      {visibleStatuses.map((status) => {
        const cfg = STATUS_CONFIG[status];
        const issues = MOCK_ISSUES.filter((i) => i.status === status);
        return (
          <div key={status} className="flex w-72 shrink-0 flex-col">
            {/* Column header */}
            <div className="mb-3 flex items-center gap-2 px-1">
              <span className={`h-2 w-2 rounded-full ${cfg.dotColor}`} />
              <span className="text-sm font-semibold">{cfg.label}</span>
              <span className="text-xs text-muted-foreground">{issues.length}</span>
            </div>
            {/* Cards */}
            <div className="flex-1 space-y-2 overflow-y-auto">
              {issues.map((issue) => (
                <BoardCard key={issue.id} issue={issue} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// List View
// ---------------------------------------------------------------------------

function ListRow({ issue }: { issue: MockIssue }) {
  const due = formatDueDate(issue.dueDate);
  const isOverdue =
    issue.dueDate && new Date(issue.dueDate) < new Date() && issue.status !== "done";

  return (
    <Link
      href={`/issues/${issue.id}`}
      className="flex items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-accent/50"
    >
      <PriorityBadge priority={issue.priority} />
      <span className="shrink-0 text-xs text-muted-foreground w-16">{issue.key}</span>
      <span className="min-w-0 flex-1 truncate">{issue.title}</span>
      {due && (
        <span
          className={`flex shrink-0 items-center gap-1 text-xs ${
            isOverdue ? "text-red-500" : "text-muted-foreground"
          }`}
        >
          <Calendar className="h-3 w-3" />
          {due}
        </span>
      )}
      <AssigneeAvatar assignee={issue.assignee} />
    </Link>
  );
}

function ListView() {
  const visibleStatuses: IssueStatus[] = [
    "in_review",
    "in_progress",
    "todo",
    "backlog",
    "done",
  ];

  return (
    <div className="overflow-y-auto">
      {visibleStatuses.map((status) => {
        const cfg = STATUS_CONFIG[status];
        const issues = MOCK_ISSUES.filter((i) => i.status === status);
        if (issues.length === 0) return null;
        return (
          <div key={status}>
            {/* Group header */}
            <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2">
              <span className={`h-2 w-2 rounded-full ${cfg.dotColor}`} />
              <span className="text-xs font-semibold">{cfg.label}</span>
              <span className="text-xs text-muted-foreground">{issues.length}</span>
            </div>
            {/* Rows */}
            <div className="divide-y">
              {issues.map((issue) => (
                <ListRow key={issue.id} issue={issue} />
              ))}
            </div>
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

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold">All Issues</h1>
          {/* View toggle */}
          <div className="flex items-center rounded-md border p-0.5">
            <button
              onClick={() => setView("board")}
              className={`flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs transition-colors ${
                view === "board"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Columns3 className="h-3.5 w-3.5" />
              Board
            </button>
            <button
              onClick={() => setView("list")}
              className={`flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs transition-colors ${
                view === "list"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <List className="h-3.5 w-3.5" />
              List
            </button>
          </div>
        </div>
        <button className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground">
          <Plus className="h-3.5 w-3.5" />
          New Issue
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {view === "board" ? <BoardView /> : <ListView />}
      </div>
    </div>
  );
}
