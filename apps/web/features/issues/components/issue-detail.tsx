"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useDefaultLayout, usePanelRef } from "react-resizable-panels";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  Bot,
  Calendar,
  ChevronRight,
  Link2,
  MoreHorizontal,
  PanelRight,
  Pencil,
  Trash2,
  UserMinus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Input } from "@/components/ui/input";
import { RichTextEditor, type RichTextEditorRef } from "@/components/common/rich-text-editor";
import { Markdown } from "@/components/markdown";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { ActorAvatar } from "@/components/common/actor-avatar";
import type { Issue, Comment, UpdateIssueRequest, IssueStatus, IssuePriority } from "@/shared/types";
import { ALL_STATUSES, STATUS_CONFIG, PRIORITY_ORDER, PRIORITY_CONFIG } from "@/features/issues/config";
import { StatusIcon, PriorityIcon } from "@/features/issues/components";
import { api } from "@/shared/api";
import { useAuthStore } from "@/features/auth";
import { useWorkspaceStore, useActorName } from "@/features/workspace";
import { useWSEvent } from "@/features/realtime";
import { useIssueStore } from "@/features/issues";
import type { CommentCreatedPayload, CommentUpdatedPayload, CommentDeletedPayload } from "@/shared/types";

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
// Property row
// ---------------------------------------------------------------------------

function PropRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center gap-2 rounded-md px-2 -mx-2 hover:bg-accent/50 transition-colors">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm truncate">
        {children}
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Acceptance Criteria Editor
// ---------------------------------------------------------------------------

function AcceptanceCriteriaEditor({
  criteria,
  onUpdate,
}: {
  criteria: string[];
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void;
}) {
  const [newItem, setNewItem] = useState("");

  const addItem = () => {
    if (!newItem.trim()) return;
    onUpdate({ acceptance_criteria: [...criteria, newItem.trim()] });
    setNewItem("");
  };

  const removeItem = (index: number) => {
    onUpdate({ acceptance_criteria: criteria.filter((_, i) => i !== index) });
  };

  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">Acceptance Criteria</h3>
      {criteria.length > 0 && (
        <div className="space-y-1">
          {criteria.map((item, i) => (
            <div key={i} className="group flex items-start gap-2 text-sm">
              <span className="mt-0.5 text-muted-foreground">&bull;</span>
              <span className="flex-1">{item}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => removeItem(i)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      {(criteria.length > 0 || adding) ? (
        <form
          onSubmit={(e) => { e.preventDefault(); addItem(); }}
          className="flex items-center gap-2"
        >
          <input
            autoFocus={adding}
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onBlur={() => { if (!newItem.trim()) setAdding(false); }}
            placeholder="Add criteria..."
            aria-label="Add acceptance criteria"
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </form>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-7 px-2 text-xs"
          onClick={() => setAdding(true)}
        >
          + Add acceptance criteria
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context Refs Editor
// ---------------------------------------------------------------------------

function ContextRefsEditor({
  refs,
  onUpdate,
}: {
  refs: string[];
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void;
}) {
  const [newRef, setNewRef] = useState("");

  const addRef = () => {
    if (!newRef.trim()) return;
    onUpdate({ context_refs: [...refs, newRef.trim()] });
    setNewRef("");
  };

  const removeRef = (index: number) => {
    onUpdate({ context_refs: refs.filter((_, i) => i !== index) });
  };

  const [adding, setAdding] = useState(false);

  const isUrl = (s: string) => s.startsWith("http://") || s.startsWith("https://");

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">Context References</h3>
      {refs.length > 0 && (
        <div className="space-y-1">
          {refs.map((ref, i) => (
            <div key={i} className="group flex items-center gap-2 text-sm">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {isUrl(ref) ? (
                <a href={ref} target="_blank" rel="noopener noreferrer" className="flex-1 text-info hover:underline truncate">
                  {ref}
                </a>
              ) : (
                <span className="flex-1 truncate">{ref}</span>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => removeRef(i)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      {(refs.length > 0 || adding) ? (
        <form
          onSubmit={(e) => { e.preventDefault(); addRef(); }}
          className="flex items-center gap-2"
        >
          <input
            autoFocus={adding}
            value={newRef}
            onChange={(e) => setNewRef(e.target.value)}
            onBlur={() => { if (!newRef.trim()) setAdding(false); }}
            placeholder="Add reference URL..."
            aria-label="Add context reference URL"
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </form>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-7 px-2 text-xs"
          onClick={() => setAdding(true)}
        >
          + Add context reference
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface IssueDetailProps {
  issueId: string;
  onDelete?: () => void;
}

// ---------------------------------------------------------------------------
// IssueDetail
// ---------------------------------------------------------------------------

export function IssueDetail({ issueId, onDelete }: IssueDetailProps) {
  const id = issueId;
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const members = useWorkspaceStore((s) => s.members);
  const agents = useWorkspaceStore((s) => s.agents);
  const { getActorName, getActorInitials } = useActorName();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "multica_issue_detail_layout",
  });
  const sidebarRef = usePanelRef();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentEmpty, setCommentEmpty] = useState(true);
  const commentEditorRef = useRef<RichTextEditorRef>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Watch the global issue store for real-time updates from other users/agents
  const storeIssue = useIssueStore((s) => s.issues.find((i) => i.id === id));

  useEffect(() => {
    if (storeIssue) {
      setIssue(storeIssue);
    }
  }, [storeIssue]);

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

  const handleSubmitComment = async () => {
    const content = commentEditorRef.current?.getMarkdown()?.trim();
    if (!content || submitting || !user) return;
    const tempId = "temp-" + Date.now();
    const tempComment: Comment = {
      id: tempId,
      issue_id: id,
      author_type: "member",
      author_id: user.id,
      content,
      type: "comment",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setComments((prev) => [...prev, tempComment]);
    commentEditorRef.current?.clearContent();
    setCommentEmpty(true);
    setSubmitting(true);
    try {
      const comment = await api.createComment(id, content);
      setComments((prev) => prev.map((c) => (c.id === tempId ? comment : c)));
    } catch {
      setComments((prev) => prev.filter((c) => c.id !== tempId));
      toast.error("Failed to send comment");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateField = useCallback(
    (updates: Partial<UpdateIssueRequest>) => {
      if (!issue) return;
      const prev = issue;
      setIssue((curr) => (curr ? ({ ...curr, ...updates } as Issue) : curr));
      api.updateIssue(id, updates).catch(() => {
        setIssue(prev);
        toast.error("Failed to update issue");
      });
    },
    [issue, id],
  );

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteIssue(issue!.id);
      toast.success("Issue deleted");
      if (onDelete) onDelete();
      else router.push("/issues");
    } catch {
      toast.error("Failed to delete issue");
      setDeleting(false);
    }
  };

  const startEditComment = (c: Comment) => {
    setEditingCommentId(c.id);
    setEditContent(c.content);
  };

  const handleSaveEditComment = async () => {
    if (!editingCommentId || !editContent.trim()) return;
    try {
      const updated = await api.updateComment(editingCommentId, editContent.trim());
      setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setEditingCommentId(null);
    } catch {
      toast.error("Failed to update comment");
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      await api.deleteComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch {
      toast.error("Failed to delete comment");
    }
  };

  // Real-time comment updates
  useWSEvent(
    "comment:created",
    useCallback((payload: unknown) => {
      const { comment } = payload as CommentCreatedPayload;
      if (comment.issue_id !== id) return;
      // Skip own comments — already added locally via API response
      if (comment.author_type === "member" && comment.author_id === user?.id) return;
      setComments((prev) => {
        if (prev.some((c) => c.id === comment.id)) return prev;
        return [...prev, comment];
      });
    }, [id, user?.id]),
  );

  useWSEvent(
    "comment:updated",
    useCallback((payload: unknown) => {
      const { comment } = payload as CommentUpdatedPayload;
      if (comment.issue_id === id) {
        setComments((prev) => prev.map((c) => (c.id === comment.id ? comment : c)));
      }
    }, [id]),
  );

  useWSEvent(
    "comment:deleted",
    useCallback((payload: unknown) => {
      const { comment_id, issue_id } = payload as CommentDeletedPayload;
      if (issue_id === id) {
        setComments((prev) => prev.filter((c) => c.id !== comment_id));
      }
    }, [id]),
  );

  if (loading) {
    return (
      <div className="flex flex-1 min-h-0 items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="flex flex-1 min-h-0 items-center justify-center text-sm text-muted-foreground">
        Issue not found
      </div>
    );
  }

  return (
    <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
      <ResizablePanel id="content" minSize="50%">
      {/* LEFT: Content area */}
      <div className="flex h-full flex-col">
        {/* Header bar */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b bg-background px-4 text-sm">
          <div className="flex items-center gap-1.5">
            <Link
              href="/issues"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Issues
            </Link>
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            <span className="truncate text-muted-foreground">{issue.id.slice(0, 8)}</span>
          </div>
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon-xs" className="text-muted-foreground">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-auto">
                {/* Status */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <StatusIcon status={issue.status} className="h-3.5 w-3.5" />
                    Status
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {ALL_STATUSES.map((s) => (
                      <DropdownMenuItem
                        key={s}
                        onClick={() => handleUpdateField({ status: s })}
                      >
                        <StatusIcon status={s} className="h-3.5 w-3.5" />
                        {STATUS_CONFIG[s].label}
                        {issue.status === s && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                {/* Priority */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <PriorityIcon priority={issue.priority} />
                    Priority
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {PRIORITY_ORDER.map((p) => (
                      <DropdownMenuItem
                        key={p}
                        onClick={() => handleUpdateField({ priority: p })}
                      >
                        <PriorityIcon priority={p} />
                        {PRIORITY_CONFIG[p].label}
                        {issue.priority === p && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                {/* Assignee */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <UserMinus className="h-3.5 w-3.5" />
                    Assignee
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem
                      onClick={() => handleUpdateField({ assignee_type: null, assignee_id: null })}
                    >
                      <UserMinus className="h-3.5 w-3.5 text-muted-foreground" />
                      Unassigned
                      {!issue.assignee_type && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
                    </DropdownMenuItem>
                    {members.map((m) => (
                      <DropdownMenuItem
                        key={m.user_id}
                        onClick={() => handleUpdateField({ assignee_type: "member", assignee_id: m.user_id })}
                      >
                        <div className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[8px] font-medium text-muted-foreground">
                          {getActorInitials("member", m.user_id)}
                        </div>
                        {m.name}
                        {issue.assignee_type === "member" && issue.assignee_id === m.user_id && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
                      </DropdownMenuItem>
                    ))}
                    {agents.map((a) => (
                      <DropdownMenuItem
                        key={a.id}
                        onClick={() => handleUpdateField({ assignee_type: "agent", assignee_id: a.id })}
                      >
                        <div className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-info/10 text-info">
                          <Bot className="size-2.5" />
                        </div>
                        {a.name}
                        {issue.assignee_type === "agent" && issue.assignee_id === a.id && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                {/* Due date */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Calendar className="h-3.5 w-3.5" />
                    Due date
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => handleUpdateField({ due_date: new Date().toISOString() })}>
                      Today
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => {
                      const d = new Date(); d.setDate(d.getDate() + 1);
                      handleUpdateField({ due_date: d.toISOString() });
                    }}>
                      Tomorrow
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => {
                      const d = new Date(); d.setDate(d.getDate() + 7);
                      handleUpdateField({ due_date: d.toISOString() });
                    }}>
                      Next week
                    </DropdownMenuItem>
                    {issue.due_date && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleUpdateField({ due_date: null })}>
                          Clear date
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <DropdownMenuSeparator />

                {/* Copy link */}
                <DropdownMenuItem onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  toast.success("Link copied");
                }}>
                  <Link2 className="h-3.5 w-3.5" />
                  Copy link
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* Delete */}
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete issue
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant={sidebarOpen ? "secondary" : "ghost"}
              size="icon-xs"
              className={sidebarOpen ? "" : "text-muted-foreground"}
              onClick={() => {
                const panel = sidebarRef.current;
                if (!panel) return;
                if (panel.isCollapsed()) panel.expand();
                else panel.collapse();
              }}
            >
              <PanelRight className="h-4 w-4" />
            </Button>
          </div>

            {/* Delete confirmation dialog (controlled by state) */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete issue</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete this issue and all its comments. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    disabled={deleting}
                    className="bg-destructive text-white hover:bg-destructive/90"
                  >
                    {deleting ? "Deleting..." : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

        {/* Content — scrollable */}
        <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-8 py-8">
          <div className="mb-1 text-sm text-muted-foreground">{issue.id.slice(0, 8)}</div>

          {editingTitle ? (
            <Input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                if (titleDraft.trim()) handleUpdateField({ title: titleDraft.trim() });
                setEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (titleDraft.trim()) handleUpdateField({ title: titleDraft.trim() });
                  setEditingTitle(false);
                } else if (e.key === "Escape") {
                  setEditingTitle(false);
                }
              }}
              className="text-xl font-semibold leading-snug tracking-tight"
            />
          ) : (
            <h1
              className="text-xl font-semibold leading-snug tracking-tight cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1"
              onClick={() => { setTitleDraft(issue.title); setEditingTitle(true); }}
            >
              {issue.title}
            </h1>
          )}

          <RichTextEditor
            defaultValue={issue.description || ""}
            placeholder="Add description..."
            onUpdate={(md) => handleUpdateField({ description: md || undefined })}
            debounceMs={1500}
            className="mt-5"
          />

          <div className="space-y-4 mt-4">
            <AcceptanceCriteriaEditor
              criteria={issue.acceptance_criteria}
              onUpdate={handleUpdateField}
            />
            <ContextRefsEditor
              refs={issue.context_refs}
              onUpdate={handleUpdateField}
            />
          </div>

          <div className="my-8 border-t" />

          {/* Activity / Comments */}
          <div>
            <h2 className="text-sm font-medium">Activity</h2>

            <div className="mt-4">
              {comments.map((comment) => {
                const isOwn = comment.author_type === "member" && comment.author_id === user?.id;
                return (
                  <div key={comment.id} className={`group relative py-3${comment.id.startsWith("temp-") ? " opacity-60" : ""}`}>
                    <div className="flex items-center gap-2.5">
                      <ActorAvatar
                        actorType={comment.author_type}
                        actorId={comment.author_id}
                        size={28}
                      />
                      <span className="text-sm font-medium">
                        {getActorName(comment.author_type, comment.author_id)}
                      </span>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span className="text-xs text-muted-foreground cursor-default">
                              {timeAgo(comment.created_at)}
                            </span>
                          }
                        />
                        <TooltipContent side="top">
                          {new Date(comment.created_at).toLocaleString()}
                        </TooltipContent>
                      </Tooltip>
                      {isOwn && (
                        <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => startEditComment(comment)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleDeleteComment(comment.id)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                    {editingCommentId === comment.id ? (
                      <form onSubmit={(e) => { e.preventDefault(); handleSaveEditComment(); }} className="mt-2 pl-9.5">
                        <input
                          autoFocus
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          aria-label="Edit comment"
                          className="w-full text-sm bg-transparent border-b outline-none"
                          onKeyDown={(e) => { if (e.key === "Escape") setEditingCommentId(null); }}
                        />
                      </form>
                    ) : (
                      <div className="mt-2 pl-9.5 text-sm leading-relaxed text-foreground/85">
                        <Markdown mode="minimal">{comment.content}</Markdown>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Comment input */}
            <div className="mt-4 rounded-md border bg-muted/30">
              <div className="min-h-20 max-h-48 overflow-y-auto px-3 py-2">
                <RichTextEditor
                  ref={commentEditorRef}
                  placeholder="Leave a comment..."
                  onUpdate={(md) => setCommentEmpty(!md.trim())}
                  onSubmit={handleSubmitComment}
                  debounceMs={100}
                />
              </div>
              <div className="flex items-center justify-end px-2 pb-2">
                <Button
                  size="icon-xs"
                  disabled={commentEmpty || submitting}
                  onClick={handleSubmitComment}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel
        id="sidebar"
        defaultSize={320}
        minSize={260}
        maxSize={420}
        collapsible
        groupResizeBehavior="preserve-pixel-size"
        panelRef={sidebarRef}
        onResize={(size) => setSidebarOpen(size.inPixels > 0)}
      >
      {/* RIGHT: Properties sidebar */}
      <div className="overflow-y-auto border-l h-full">
        <div className="p-4">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Properties
          </div>

          <div className="space-y-0.5">
            {/* Status */}
            <PropRow label="Status">
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-1.5 cursor-pointer rounded px-1 -mx-1 hover:bg-accent/30 transition-colors overflow-hidden">
                  <StatusIcon status={issue.status} className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{STATUS_CONFIG[issue.status].label}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  <DropdownMenuRadioGroup value={issue.status} onValueChange={(v) => handleUpdateField({ status: v as IssueStatus })}>
                    {ALL_STATUSES.map((s) => (
                      <DropdownMenuRadioItem key={s} value={s}>
                        <StatusIcon status={s} className="h-3.5 w-3.5" />
                        {STATUS_CONFIG[s].label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </PropRow>

            {/* Priority */}
            <PropRow label="Priority">
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-1.5 cursor-pointer rounded px-1 -mx-1 hover:bg-accent/30 transition-colors overflow-hidden">
                  <PriorityIcon priority={issue.priority} className="shrink-0" />
                  <span className="truncate">{PRIORITY_CONFIG[issue.priority].label}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  <DropdownMenuRadioGroup value={issue.priority} onValueChange={(v) => handleUpdateField({ priority: v as IssuePriority })}>
                    {PRIORITY_ORDER.map((p) => (
                      <DropdownMenuRadioItem key={p} value={p}>
                        <PriorityIcon priority={p} />
                        {PRIORITY_CONFIG[p].label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </PropRow>

            {/* Assignee */}
            <PropRow label="Assignee">
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-1.5 cursor-pointer rounded px-1 -mx-1 hover:bg-accent/30 transition-colors overflow-hidden">
                  {issue.assignee_type && issue.assignee_id ? (
                    <>
                      <div className={`inline-flex shrink-0 items-center justify-center rounded-full font-medium text-[8px] size-4 ${
                        issue.assignee_type === "agent" ? "bg-info/10 text-info" : "bg-muted text-muted-foreground"
                      }`}>
                        {issue.assignee_type === "agent" ? <Bot className="size-2.5" /> : getActorInitials(issue.assignee_type, issue.assignee_id)}
                      </div>
                      <span className="truncate">{getActorName(issue.assignee_type, issue.assignee_id)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  <DropdownMenuItem onClick={() => handleUpdateField({ assignee_type: null, assignee_id: null })}>
                    <UserMinus className="h-3.5 w-3.5 text-muted-foreground" />
                    Unassigned
                  </DropdownMenuItem>
                  {members.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>Members</DropdownMenuLabel>
                        {members.map((m) => (
                          <DropdownMenuItem key={m.user_id} onClick={() => handleUpdateField({ assignee_type: "member", assignee_id: m.user_id })}>
                            <div className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[8px] font-medium text-muted-foreground">
                              {getActorInitials("member", m.user_id)}
                            </div>
                            {m.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    </>
                  )}
                  {agents.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>Agents</DropdownMenuLabel>
                        {agents.map((a) => (
                          <DropdownMenuItem key={a.id} onClick={() => handleUpdateField({ assignee_type: "agent", assignee_id: a.id })}>
                            <div className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-info/10 text-info">
                              <Bot className="size-2.5" />
                            </div>
                            {a.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </PropRow>

            {/* Due date */}
            <PropRow label="Due date">
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-1.5 cursor-pointer rounded px-1 -mx-1 hover:bg-accent/30 transition-colors overflow-hidden">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {issue.due_date ? (
                    <span className={new Date(issue.due_date) < new Date() ? "text-destructive" : ""}>
                      {shortDate(issue.due_date)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-auto">
                  <DropdownMenuItem onClick={() => handleUpdateField({ due_date: new Date().toISOString() })}>
                    Today
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {
                    const d = new Date(); d.setDate(d.getDate() + 1);
                    handleUpdateField({ due_date: d.toISOString() });
                  }}>
                    Tomorrow
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {
                    const d = new Date(); d.setDate(d.getDate() + 7);
                    handleUpdateField({ due_date: d.toISOString() });
                  }}>
                    Next week
                  </DropdownMenuItem>
                  {issue.due_date && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleUpdateField({ due_date: null })}>
                        Clear date
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </PropRow>

            {/* Created by */}
            <PropRow label="Created by">
              <ActorAvatar
                actorType={issue.creator_type}
                actorId={issue.creator_id}
                size={18}
              />
              <span className="truncate">{getActorName(issue.creator_type, issue.creator_id)}</span>
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
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
