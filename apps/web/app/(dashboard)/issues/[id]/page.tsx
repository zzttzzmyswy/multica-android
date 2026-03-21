"use client";

import { use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  Calendar,
  ChevronRight,
  User,
} from "lucide-react";
import {
  MOCK_ISSUES,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
} from "../_data/mock";
import type { MockAssignee } from "../_data/mock";
import { StatusIcon, PriorityIcon } from "../page";

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
  if (!date) return "None";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ActorAvatar({ actor, size = "sm" }: { actor: MockAssignee; size?: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-xs";
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-medium ${sizeClass} ${
        actor.type === "agent"
          ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {actor.type === "agent" ? (
        <Bot className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      ) : (
        actor.avatar.charAt(0)
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Properties Sidebar
// ---------------------------------------------------------------------------

function PropertyRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
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
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Issue not found
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[issue.status];
  const priorityCfg = PRIORITY_CONFIG[issue.priority];
  const isOverdue =
    issue.dueDate && new Date(issue.dueDate) < new Date() && issue.status !== "done";

  const timeline = [
    ...issue.activity.map((a) => ({
      id: a.id,
      kind: "activity" as const,
      actor: a.actor,
      content: a.action,
      createdAt: a.createdAt,
    })),
    ...issue.comments.map((c) => ({
      id: c.id,
      kind: "comment" as const,
      actor: c.author,
      content: c.body,
      createdAt: c.createdAt,
    })),
  ].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return (
    <div className="flex h-full">
      {/* ---- Left: Content ---- */}
      <div className="flex-1 overflow-y-auto">
        {/* Breadcrumb bar */}
        <div className="flex h-11 items-center gap-1.5 border-b px-6 text-xs">
          <Link
            href="/issues"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Issues
          </Link>
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">{issue.key}</span>
        </div>

        <div className="max-w-2xl px-10 py-8">
          {/* Title */}
          <h1 className="text-lg font-semibold leading-snug">{issue.title}</h1>

          {/* Description */}
          {issue.description && (
            <div className="mt-4 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/80">
              {issue.description}
            </div>
          )}

          {/* Activity */}
          <div className="mt-10">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Activity
              </h2>
            </div>

            <div className="space-y-3">
              {timeline.map((entry) =>
                entry.kind === "comment" ? (
                  <div key={entry.id} className="flex gap-2.5">
                    <ActorAvatar actor={entry.actor} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[13px] font-medium">
                          {entry.actor.name}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {timeAgo(entry.createdAt)}
                        </span>
                      </div>
                      <div className="mt-1 whitespace-pre-wrap rounded-md border px-3 py-2 text-[13px] leading-relaxed text-foreground/80">
                        {entry.content}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    key={entry.id}
                    className="flex items-center gap-2.5 pl-1 text-[12px] text-muted-foreground"
                  >
                    <div className="flex h-6 w-6 items-center justify-center">
                      <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
                    </div>
                    <span className="font-medium text-foreground/70">
                      {entry.actor.name}
                    </span>
                    <span>{entry.content}</span>
                    <span className="ml-auto shrink-0">
                      {timeAgo(entry.createdAt)}
                    </span>
                  </div>
                )
              )}

              {/* Comment placeholder */}
              <div className="flex gap-2.5 pt-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                  <User className="h-3 w-3 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1 cursor-text rounded-md border px-3 py-2 text-[13px] text-muted-foreground">
                  Leave a comment...
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---- Right: Properties ---- */}
      <div className="w-56 shrink-0 overflow-y-auto border-l px-4 py-4">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Properties
        </div>

        <div className="divide-y">
          <PropertyRow label="Status">
            <StatusIcon status={issue.status} className="h-3.5 w-3.5" />
            <span className={`text-xs font-medium ${statusCfg.iconColor}`}>
              {statusCfg.label}
            </span>
          </PropertyRow>

          <PropertyRow label="Priority">
            <PriorityIcon priority={issue.priority} />
            <span className="text-xs">{priorityCfg.label}</span>
          </PropertyRow>

          <PropertyRow label="Assignee">
            {issue.assignee ? (
              <>
                <ActorAvatar actor={issue.assignee} />
                <span className="text-xs">{issue.assignee.name}</span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">Unassigned</span>
            )}
          </PropertyRow>

          <PropertyRow label="Due Date">
            <Calendar className="h-3 w-3 text-muted-foreground" />
            <span
              className={`text-xs ${isOverdue ? "font-medium text-red-500" : ""}`}
            >
              {formatDate(issue.dueDate)}
            </span>
          </PropertyRow>

          <PropertyRow label="Created by">
            <ActorAvatar actor={issue.creator} />
            <span className="text-xs">{issue.creator.name}</span>
          </PropertyRow>

          <PropertyRow label="Created">
            <span className="text-xs">{formatDate(issue.createdAt)}</span>
          </PropertyRow>

          <PropertyRow label="Updated">
            <span className="text-xs">{formatDate(issue.updatedAt)}</span>
          </PropertyRow>
        </div>
      </div>
    </div>
  );
}
