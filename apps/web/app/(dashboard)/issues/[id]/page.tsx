"use client";

import { use } from "react";
import Link from "next/link";
import {
  Bot,
  Calendar,
  ChevronRight,
  User,
  MessageSquare,
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
  if (minutes < 1) return "just now";
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

function shortDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

function Avatar({
  person,
  size = 20,
}: {
  person: MockAssignee;
  size?: number;
}) {
  const isAgent = person.type === "agent";
  return (
    <div
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-medium ${
        isAgent
          ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
          : "bg-muted text-muted-foreground"
      }`}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      title={person.name}
    >
      {isAgent ? <Bot style={{ width: size * 0.55, height: size * 0.55 }} /> : person.avatar.charAt(0)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Property row (Linear-style: label left, clickable value right)
// ---------------------------------------------------------------------------

function PropRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[32px] items-center gap-3 rounded-md px-2 -mx-2 hover:bg-accent/50 transition-colors">
      <span className="w-20 shrink-0 text-[13px] text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-[13px]">
        {children}
      </div>
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

  // Merge activity + comments into timeline
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
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return (
    <div className="flex h-full">
      {/* ================================================================
          LEFT: Content area
          ================================================================ */}
      <div className="flex-1 overflow-y-auto">
        {/* Header bar */}
        <div className="sticky top-0 z-10 flex h-11 items-center gap-1.5 border-b bg-background px-6 text-[13px]">
          <Link
            href="/issues"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Issues
          </Link>
          <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
          <span className="truncate text-muted-foreground">{issue.key}</span>
        </div>

        {/* Content */}
        <div className="mx-auto w-full max-w-3xl px-8 py-8">
          {/* Issue key */}
          <div className="mb-1 text-[13px] text-muted-foreground">{issue.key}</div>

          {/* Title */}
          <h1 className="text-xl font-semibold leading-snug tracking-tight">
            {issue.title}
          </h1>

          {/* Description */}
          {issue.description && (
            <div className="mt-5 text-[14px] leading-[1.7] text-foreground/85 whitespace-pre-wrap">
              {issue.description}
            </div>
          )}

          {/* Separator */}
          <div className="my-8 border-t" />

          {/* Activity */}
          <div>
            <h2 className="mb-5 text-[13px] font-medium">Activity</h2>

            <div className="space-y-4">
              {timeline.map((entry) =>
                entry.kind === "comment" ? (
                  /* ---- Comment ---- */
                  <div key={entry.id} className="flex gap-3">
                    <Avatar person={entry.actor} size={24} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[13px] font-medium">
                          {entry.actor.name}
                        </span>
                        <span className="text-[12px] text-muted-foreground">
                          {timeAgo(entry.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/80 whitespace-pre-wrap">
                        {entry.content}
                      </p>
                    </div>
                  </div>
                ) : (
                  /* ---- Activity entry ---- */
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 text-[12px] text-muted-foreground"
                  >
                    <Avatar person={entry.actor} size={18} />
                    <span>
                      <span className="font-medium text-foreground/70">
                        {entry.actor.name}
                      </span>{" "}
                      {entry.content}
                    </span>
                    <span className="ml-auto shrink-0">{timeAgo(entry.createdAt)}</span>
                  </div>
                )
              )}
            </div>

            {/* Comment input */}
            <div className="mt-6 flex gap-3">
              <div
                className="flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                style={{ width: 24, height: 24 }}
              >
                <User className="h-3 w-3" />
              </div>
              <div className="min-w-0 flex-1 cursor-text rounded-lg border px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:border-foreground/20">
                Leave a comment...
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================
          RIGHT: Properties sidebar
          ================================================================ */}
      <div className="w-60 shrink-0 overflow-y-auto border-l">
        <div className="p-4">
          <div className="mb-2 text-[12px] font-medium text-muted-foreground">
            Properties
          </div>

          <div className="space-y-0.5">
            <PropRow label="Status">
              <StatusIcon status={issue.status} className="h-3.5 w-3.5" />
              <span className={statusCfg.iconColor}>{statusCfg.label}</span>
            </PropRow>

            <PropRow label="Priority">
              <PriorityIcon priority={issue.priority} />
              <span>{priorityCfg.label}</span>
            </PropRow>

            <PropRow label="Assignee">
              {issue.assignee ? (
                <>
                  <Avatar person={issue.assignee} size={18} />
                  <span>{issue.assignee.name}</span>
                </>
              ) : (
                <span className="text-muted-foreground">Unassigned</span>
              )}
            </PropRow>

            <PropRow label="Due date">
              {issue.dueDate ? (
                <span className={isOverdue ? "text-red-500" : ""}>
                  {shortDate(issue.dueDate)}
                </span>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </PropRow>

            <PropRow label="Created by">
              <Avatar person={issue.creator} size={18} />
              <span>{issue.creator.name}</span>
            </PropRow>
          </div>

          <div className="mt-4 border-t pt-3 space-y-0.5">
            <PropRow label="Created">
              <span className="text-muted-foreground">{shortDate(issue.createdAt)}</span>
            </PropRow>
            <PropRow label="Updated">
              <span className="text-muted-foreground">{shortDate(issue.updatedAt)}</span>
            </PropRow>
          </div>
        </div>
      </div>
    </div>
  );
}
