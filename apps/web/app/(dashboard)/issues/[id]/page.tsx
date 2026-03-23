"use client";

import { use, useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  Bot,
  ChevronRight,
  Send,
  UserCircle,
  X,
} from "lucide-react";
import type { Issue, Comment, IssueAssigneeType } from "@multica/types";
import { STATUS_CONFIG, PRIORITY_CONFIG } from "../_data/config";
import { StatusIcon, PriorityIcon } from "../page";
import { api } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";

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

function shortDate(date: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

function ActorAvatar({
  actorType,
  actorId,
  size = 20,
}: {
  actorType: string;
  actorId: string;
  size?: number;
}) {
  const { getActorName, getActorInitials } = useAuth();
  const name = getActorName(actorType, actorId);
  const initials = getActorInitials(actorType, actorId);
  const isAgent = actorType === "agent";
  return (
    <div
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-medium ${
        isAgent
          ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
          : "bg-muted text-muted-foreground"
      }`}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      title={name}
    >
      {isAgent ? (
        <Bot style={{ width: size * 0.55, height: size * 0.55 }} />
      ) : (
        initials
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Property row
// ---------------------------------------------------------------------------

function PropRow({
  label,
  children,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex min-h-[32px] items-center gap-3 rounded-md px-2 -mx-2 hover:bg-accent/50 transition-colors ${
        onClick ? "cursor-pointer" : ""
      }`}
    >
      <span className="w-20 shrink-0 text-[13px] text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-[13px]">
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assignee Picker
// ---------------------------------------------------------------------------

function AssigneePicker({
  issue,
  onSelect,
  onClose,
}: {
  issue: Issue;
  onSelect: (type: IssueAssigneeType | null, id: string | null) => void;
  onClose: () => void;
}) {
  const { members, agents } = useAuth();
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const q = search.toLowerCase();
  const filteredMembers = members.filter((m) =>
    m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
  );
  const filteredAgents = agents.filter((a) =>
    a.name.toLowerCase().includes(q),
  );

  const isSelected = (type: string, id: string) =>
    issue.assignee_type === type && issue.assignee_id === id;

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border bg-popover shadow-md"
    >
      <div className="p-2">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="w-full rounded-md border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="max-h-64 overflow-y-auto px-1 pb-1">
        {/* Unassign option */}
        {issue.assignee_id && (
          <>
            <button
              onClick={() => onSelect(null, null)}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs hover:bg-accent"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Unassign</span>
            </button>
            <div className="my-1 border-t mx-1" />
          </>
        )}

        {/* Members */}
        {filteredMembers.length > 0 && (
          <>
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Members
            </div>
            {filteredMembers.map((m) => (
              <button
                key={m.user_id}
                onClick={() => onSelect("member", m.user_id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs transition-colors ${
                  isSelected("member", m.user_id) ? "bg-accent" : "hover:bg-accent/50"
                }`}
              >
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                  {m.name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate font-medium">{m.name}</div>
                </div>
                {isSelected("member", m.user_id) && (
                  <span className="text-primary text-[10px] font-medium">Assigned</span>
                )}
              </button>
            ))}
          </>
        )}

        {/* Agents */}
        {filteredAgents.length > 0 && (
          <>
            <div className="px-2 py-1 mt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Agents
            </div>
            {filteredAgents.map((a) => (
              <button
                key={a.id}
                onClick={() => onSelect("agent", a.id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs transition-colors ${
                  isSelected("agent", a.id) ? "bg-accent" : "hover:bg-accent/50"
                }`}
              >
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                  <Bot className="h-3 w-3" />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate font-medium">{a.name}</div>
                </div>
                {isSelected("agent", a.id) && (
                  <span className="text-primary text-[10px] font-medium">Assigned</span>
                )}
              </button>
            ))}
          </>
        )}

        {filteredMembers.length === 0 && filteredAgents.length === 0 && (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            No results found
          </div>
        )}
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
  const { getActorName } = useAuth();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);

  useEffect(() => {
    setIssue(null);
    setComments([]);
    setLoading(true);
    Promise.all([api.getIssue(id), api.listComments(id)])
      .then(([iss, cmts]) => {
        setIssue(iss);
        setComments(cmts);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim() || submitting) return;
    setSubmitting(true);
    try {
      const comment = await api.createComment(id, commentText.trim());
      setComments((prev) => [...prev, comment]);
      setCommentText("");
    } catch (err) {
      console.error("Failed to create comment:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssigneeChange = async (
    type: IssueAssigneeType | null,
    assigneeId: string | null,
  ) => {
    if (!issue) return;
    setShowAssigneePicker(false);
    // Optimistic update
    setIssue({
      ...issue,
      assignee_type: type,
      assignee_id: assigneeId,
    });
    try {
      const updated = await api.updateIssue(id, {
        assignee_type: type,
        assignee_id: assigneeId,
      });
      setIssue(updated);
    } catch (err) {
      console.error("Failed to update assignee:", err);
      // Revert on error
      setIssue(issue);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

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
    issue.due_date && new Date(issue.due_date) < new Date() && issue.status !== "done";

  return (
    <div className="flex h-full">
      {/* LEFT: Content area */}
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
          <span className="truncate text-muted-foreground">{issue.id.slice(0, 8)}</span>
        </div>

        {/* Content */}
        <div className="mx-auto w-full max-w-3xl px-8 py-8">
          <div className="mb-1 text-[13px] text-muted-foreground">{issue.id.slice(0, 8)}</div>

          <h1 className="text-xl font-semibold leading-snug tracking-tight">
            {issue.title}
          </h1>

          {issue.description && (
            <div className="mt-5 text-[14px] leading-[1.7] text-foreground/85 whitespace-pre-wrap">
              {issue.description}
            </div>
          )}

          <div className="my-8 border-t" />

          {/* Activity / Comments */}
          <div>
            <h2 className="text-[13px] font-medium">Activity</h2>

            <div className="mt-4">
              {comments.map((comment) => (
                <div key={comment.id} className="relative py-3">
                  <div className="flex items-center gap-2.5">
                    <ActorAvatar
                      actorType={comment.author_type}
                      actorId={comment.author_id}
                      size={28}
                    />
                    <span className="text-[13px] font-medium">
                      {getActorName(comment.author_type, comment.author_id)}
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                      {timeAgo(comment.created_at)}
                    </span>
                  </div>
                  <div className="mt-2 pl-[38px] text-[13px] leading-[1.6] text-foreground/85 whitespace-pre-wrap">
                    {comment.content}
                  </div>
                </div>
              ))}
            </div>

            {/* Comment input */}
            <form onSubmit={handleSubmitComment} className="mt-2 border-t pt-4">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Leave a comment..."
                  className="flex-1 rounded-md border bg-background px-3 py-2 text-[13px] placeholder:text-muted-foreground"
                />
                <button
                  type="submit"
                  disabled={!commentText.trim() || submitting}
                  className="rounded-md bg-primary p-2 text-primary-foreground disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* RIGHT: Properties sidebar */}
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

            <div className="relative">
              <PropRow
                label="Assignee"
                onClick={() => setShowAssigneePicker(!showAssigneePicker)}
              >
                {issue.assignee_type && issue.assignee_id ? (
                  <>
                    <ActorAvatar
                      actorType={issue.assignee_type}
                      actorId={issue.assignee_id}
                      size={18}
                    />
                    <span>{getActorName(issue.assignee_type, issue.assignee_id)}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Unassigned</span>
                )}
              </PropRow>

              {showAssigneePicker && (
                <AssigneePicker
                  issue={issue}
                  onSelect={handleAssigneeChange}
                  onClose={() => setShowAssigneePicker(false)}
                />
              )}
            </div>

            <PropRow label="Due date">
              {issue.due_date ? (
                <span className={isOverdue ? "text-red-500" : ""}>
                  {shortDate(issue.due_date)}
                </span>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </PropRow>

            <PropRow label="Created by">
              <ActorAvatar
                actorType={issue.creator_type}
                actorId={issue.creator_id}
                size={18}
              />
              <span>{getActorName(issue.creator_type, issue.creator_id)}</span>
            </PropRow>
          </div>

          <div className="mt-4 border-t pt-3 space-y-0.5">
            <PropRow label="Created">
              <span className="text-muted-foreground">{shortDate(issue.created_at)}</span>
            </PropRow>
            <PropRow label="Updated">
              <span className="text-muted-foreground">{shortDate(issue.updated_at)}</span>
            </PropRow>
          </div>
        </div>
      </div>
    </div>
  );
}
