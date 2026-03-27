"use client";

import { useState, useMemo } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { useInboxStore } from "@/features/inbox";
import { IssueDetail, StatusIcon } from "@/features/issues/components";
import { ActorAvatar } from "@/components/common/actor-avatar";
import { toast } from "sonner";
import {
  MoreHorizontal,
  Inbox,
  CheckCheck,
  Archive,
  BookCheck,
  ListChecks,
} from "lucide-react";
import type { InboxItem, InboxItemType, InboxSeverity } from "@/shared/types";
import { Button } from "@/components/ui/button";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { api } from "@/shared/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const severityOrder: Record<InboxSeverity, number> = {
  action_required: 0,
  attention: 1,
  info: 2,
};

const typeLabels: Record<InboxItemType, string> = {
  issue_assigned: "Assigned",
  review_requested: "Review requested",
  task_completed: "Task completed",
  task_failed: "Task failed",
  agent_blocked: "Agent blocked",
  agent_completed: "Agent completed",
  mentioned: "Mentioned",
  status_change: "Status changed",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ---------------------------------------------------------------------------
// InboxListItem
// ---------------------------------------------------------------------------

function InboxListItem({
  item,
  isSelected,
  onClick,
}: {
  item: InboxItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
        isSelected ? "bg-accent" : "hover:bg-accent/50"
      }`}
    >
      <ActorAvatar
        actorType={item.actor_type ?? item.recipient_type}
        actorId={item.actor_id ?? item.recipient_id}
        size={28}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {!item.read && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
            )}
            <span
              className={`truncate text-sm ${!item.read ? "font-medium" : "text-muted-foreground"}`}
            >
              {item.title}
            </span>
          </div>
          {item.issue_status && (
            <StatusIcon status={item.issue_status} className="h-3.5 w-3.5 shrink-0" />
          )}
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className={`truncate text-xs ${item.read ? "text-muted-foreground/60" : "text-muted-foreground"}`}>
            {typeLabels[item.type] ?? item.type}
          </p>
          <span className={`shrink-0 text-xs ${item.read ? "text-muted-foreground/60" : "text-muted-foreground"}`}>
            {timeAgo(item.created_at)}
          </span>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function InboxPage() {
  const [selectedId, setSelectedId] = useState<string>("");

  const storeItems = useInboxStore((s) => s.items);
  const loading = useInboxStore((s) => s.loading);

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "multica_inbox_layout",
  });

  // Sort: severity first, then newest first
  const items = useMemo(() => {
    return [...storeItems]
      .filter((i) => !i.archived)
      .sort(
        (a, b) =>
          severityOrder[a.severity] - severityOrder[b.severity] ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
  }, [storeItems]);

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const unreadCount = items.filter((i) => !i.read).length;

  // Click-to-read: select + auto-mark-read
  const handleSelect = async (item: InboxItem) => {
    setSelectedId(item.id);
    if (!item.read) {
      try {
        await api.markInboxRead(item.id);
        useInboxStore.getState().markRead(item.id);
      } catch {
        // silent — selection still works even if mark-read fails
      }
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await api.archiveInbox(id);
      useInboxStore.getState().archive(id);
      if (selectedId === id) setSelectedId("");
    } catch {
      toast.error("Failed to archive");
    }
  };

  // Batch operations
  const handleMarkAllRead = async () => {
    try {
      useInboxStore.getState().markAllRead();
      await api.markAllInboxRead();
    } catch {
      toast.error("Failed to mark all as read");
      useInboxStore.getState().fetch();
    }
  };

  const handleArchiveAll = async () => {
    try {
      useInboxStore.getState().archiveAll();
      setSelectedId("");
      await api.archiveAllInbox();
    } catch {
      toast.error("Failed to archive all");
      useInboxStore.getState().fetch();
    }
  };

  const handleArchiveAllRead = async () => {
    try {
      const readIds = items.filter((i) => i.read).map((i) => i.id);
      useInboxStore.getState().archiveAllRead();
      if (readIds.includes(selectedId)) setSelectedId("");
      await api.archiveAllReadInbox();
    } catch {
      toast.error("Failed to archive read items");
      useInboxStore.getState().fetch();
    }
  };

  const handleArchiveCompleted = async () => {
    try {
      await api.archiveCompletedInbox();
      setSelectedId("");
      await useInboxStore.getState().fetch();
    } catch {
      toast.error("Failed to archive completed");
    }
  };

  if (loading) {
    return (
      <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
        <ResizablePanel id="list" defaultSize={320} minSize={240} maxSize={480} groupResizeBehavior="preserve-pixel-size">
          <div className="overflow-y-auto border-r h-full">
            <div className="flex h-12 items-center border-b px-4">
              <Skeleton className="h-5 w-16" />
            </div>
            <div className="space-y-1 p-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="detail" minSize="40%">
          <div className="p-6">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="mt-4 h-4 w-32" />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }

  return (
    <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
      <ResizablePanel id="list" defaultSize={320} minSize={240} maxSize={480} groupResizeBehavior="preserve-pixel-size">
      {/* Left column — inbox list */}
      <div className="overflow-y-auto border-r h-full">
        <div className="flex h-12 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold">Inbox</h1>
            {unreadCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {unreadCount}
              </span>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                />
              }
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto">
              <DropdownMenuItem onClick={handleMarkAllRead}>
                <CheckCheck className="h-4 w-4" />
                Mark all as read
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleArchiveAll}>
                <Archive className="h-4 w-4" />
                Archive all
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleArchiveAllRead}>
                <BookCheck className="h-4 w-4" />
                Archive all read
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleArchiveCompleted}>
                <ListChecks className="h-4 w-4" />
                Archive completed
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Inbox className="mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm">No notifications</p>
          </div>
        ) : (
          <div>
            {items.map((item) => (
              <InboxListItem
                key={item.id}
                item={item}
                isSelected={item.id === selectedId}
                onClick={() => handleSelect(item)}
              />
            ))}
          </div>
        )}
      </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="detail" minSize="40%">
      {/* Right column — detail */}
      <div className="flex flex-col min-h-0 h-full">
        {selected?.issue_id ? (
          <IssueDetail
            issueId={selected.issue_id}
            onDelete={() => {
              handleArchive(selected.id);
            }}
          />
        ) : selected ? (
          <div className="p-6">
            <h2 className="text-lg font-semibold">{selected.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {typeLabels[selected.type]} · {timeAgo(selected.created_at)}
            </p>
            {selected.body && (
              <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
                {selected.body}
              </div>
            )}
            <div className="mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleArchive(selected.id)}
              >
                <Archive className="mr-1.5 h-3.5 w-3.5" />
                Archive
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <Inbox className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm">
              {items.length === 0
                ? "Your inbox is empty"
                : "Select a notification to view details"}
            </p>
          </div>
        )}
      </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
