"use client";

import { use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  Calendar,
  ChevronRight,
  Circle,
  User,
} from "lucide-react";
import {
  MOCK_ISSUES,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
} from "../_data/mock";
import type { MockAssignee } from "../_data/mock";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(date: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ActorBadge({ actor }: { actor: MockAssignee }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-sm font-medium ${
        actor.type === "agent" ? "text-purple-600 dark:text-purple-400" : ""
      }`}
    >
      {actor.type === "agent" && <Bot className="h-3 w-3" />}
      {actor.name}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const issue = MOCK_ISSUES.find((i) => i.id === id);

  if (!issue) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Issue not found
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[issue.status];
  const priorityCfg = PRIORITY_CONFIG[issue.priority];
  const isOverdue =
    issue.dueDate && new Date(issue.dueDate) < new Date() && issue.status !== "done";

  // Merge comments + activity into a single timeline sorted by time
  const timeline = [
    ...issue.activity.map((a) => ({
      id: a.id,
      type: "activity" as const,
      actor: a.actor,
      content: a.action,
      createdAt: a.createdAt,
    })),
    ...issue.comments.map((c) => ({
      id: c.id,
      type: "comment" as const,
      actor: c.author,
      content: c.body,
      createdAt: c.createdAt,
    })),
  ].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return (
    <div className="flex h-full">
      {/* Left column — content */}
      <div className="flex-1 overflow-y-auto">
        {/* Breadcrumb */}
        <div className="flex h-12 items-center gap-2 border-b px-6">
          <Link
            href="/issues"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Issues
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{issue.key}</span>
        </div>

        <div className="p-6">
          {/* Title */}
          <h1 className="text-xl font-bold leading-tight">{issue.title}</h1>

          {/* Description */}
          {issue.description && (
            <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
              {issue.description}
            </div>
          )}

          {/* Activity section */}
          <div className="mt-10">
            <h2 className="text-sm font-semibold">Activity</h2>
            <div className="mt-4 space-y-4">
              {timeline.map((entry) =>
                entry.type === "comment" ? (
                  <div key={entry.id} className="flex gap-3">
                    <div
                      className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
                        entry.actor.type === "agent"
                          ? "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {entry.actor.type === "agent" ? (
                        <Bot className="h-3 w-3" />
                      ) : (
                        entry.actor.avatar.charAt(0)
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <ActorBadge actor={entry.actor} />
                        <span className="text-xs text-muted-foreground">
                          {timeAgo(entry.createdAt)}
                        </span>
                      </div>
                      <div className="mt-1 whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm text-foreground/80">
                        {entry.content}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 text-xs text-muted-foreground"
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center">
                      <Circle className="h-1.5 w-1.5 fill-current" />
                    </div>
                    <ActorBadge actor={entry.actor} />
                    <span>{entry.content}</span>
                    <span className="ml-auto">{timeAgo(entry.createdAt)}</span>
                  </div>
                )
              )}

              {/* Comment input placeholder */}
              <div className="flex gap-3 pt-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                  <User className="h-3 w-3" />
                </div>
                <div className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm text-muted-foreground">
                  Leave a comment...
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right column — properties sidebar */}
      <div className="w-64 shrink-0 overflow-y-auto border-l p-4">
        <div className="space-y-5">
          {/* Status */}
          <div>
            <div className="mb-1.5 text-xs text-muted-foreground">Status</div>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${statusCfg.dotColor}`} />
              <span className={`text-sm font-medium ${statusCfg.color}`}>
                {statusCfg.label}
              </span>
            </div>
          </div>

          {/* Priority */}
          <div>
            <div className="mb-1.5 text-xs text-muted-foreground">Priority</div>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${priorityCfg.color}`}>
                {priorityCfg.shortLabel}
              </span>
              <span className="text-sm">{priorityCfg.label}</span>
            </div>
          </div>

          {/* Assignee */}
          <div>
            <div className="mb-1.5 text-xs text-muted-foreground">Assignee</div>
            {issue.assignee ? (
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium ${
                    issue.assignee.type === "agent"
                      ? "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {issue.assignee.type === "agent" ? (
                    <Bot className="h-3 w-3" />
                  ) : (
                    issue.assignee.avatar.charAt(0)
                  )}
                </div>
                <span className="text-sm">{issue.assignee.name}</span>
                {issue.assignee.type === "agent" && (
                  <span className="text-[10px] text-purple-500">Agent</span>
                )}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Unassigned</span>
            )}
          </div>

          {/* Due Date */}
          <div>
            <div className="mb-1.5 text-xs text-muted-foreground">Due Date</div>
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <span
                className={`text-sm ${isOverdue ? "text-red-500 font-medium" : ""}`}
              >
                {formatDate(issue.dueDate)}
              </span>
            </div>
          </div>

          {/* Creator */}
          <div>
            <div className="mb-1.5 text-xs text-muted-foreground">Created by</div>
            <div className="flex items-center gap-2">
              <div
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium ${
                  issue.creator.type === "agent"
                    ? "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {issue.creator.type === "agent" ? (
                  <Bot className="h-3 w-3" />
                ) : (
                  issue.creator.avatar.charAt(0)
                )}
              </div>
              <span className="text-sm">{issue.creator.name}</span>
            </div>
          </div>

          {/* Dates */}
          <div>
            <div className="mb-1.5 text-xs text-muted-foreground">Created</div>
            <span className="text-sm">{formatDate(issue.createdAt)}</span>
          </div>
          <div>
            <div className="mb-1.5 text-xs text-muted-foreground">Updated</div>
            <span className="text-sm">{formatDate(issue.updatedAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
