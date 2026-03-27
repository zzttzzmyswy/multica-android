"use client";

import { useMemo } from "react";
import { EyeOff, MoreHorizontal, Plus } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Issue, IssueStatus } from "@/shared/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { STATUS_CONFIG, PRIORITY_ORDER } from "@/features/issues/config";
import { useModalStore } from "@/features/modals";
import { useIssueViewStore, type SortField, type SortDirection } from "@/features/issues/stores/view-store";
import { StatusIcon } from "./status-icon";
import { DraggableBoardCard } from "./board-card";

const PRIORITY_RANK: Record<string, number> = Object.fromEntries(
  PRIORITY_ORDER.map((p, i) => [p, i])
);

function sortIssues(issues: Issue[], field: SortField, direction: SortDirection): Issue[] {
  const sorted = [...issues].sort((a, b) => {
    switch (field) {
      case "priority":
        return (PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99);
      case "due_date": {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      }
      case "created_at":
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      case "title":
        return a.title.localeCompare(b.title);
      case "position":
      default:
        return a.position - b.position;
    }
  });
  return direction === "desc" ? sorted.reverse() : sorted;
}

export function BoardColumn({
  status,
  issues,
}: {
  status: IssueStatus;
  issues: Issue[];
}) {
  const cfg = STATUS_CONFIG[status];
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const sortBy = useIssueViewStore((s) => s.sortBy);
  const sortDirection = useIssueViewStore((s) => s.sortDirection);

  const sortedIssues = useMemo(
    () => sortIssues(issues, sortBy, sortDirection),
    [issues, sortBy, sortDirection]
  );

  const sortedIds = useMemo(
    () => sortedIssues.map((i) => i.id),
    [sortedIssues]
  );

  return (
    <div className="flex w-[280px] shrink-0 flex-col rounded-xl bg-muted/40 p-2">
      <div className="mb-2 flex items-center justify-between px-1.5">
        {/* Left: icon + label + count */}
        <div className="flex items-center gap-2">
          <StatusIcon status={status} className="h-3.5 w-3.5" />
          <span className="text-sm font-medium">{cfg.label}</span>
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
            {issues.length}
          </span>
        </div>

        {/* Right: add + menu */}
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" className="rounded-full text-muted-foreground">
                  <MoreHorizontal className="size-3.5" />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => useIssueViewStore.getState().hideStatus(status)}>
                <EyeOff className="size-3.5" />
                Hide column
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full text-muted-foreground"
                  onClick={() => useModalStore.getState().open("create-issue", { status })}
                >
                  <Plus className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent>Add issue</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={`min-h-[200px] flex-1 space-y-2 overflow-y-auto rounded-lg p-1 transition-colors ${
          isOver ? "bg-accent/60" : ""
        }`}
      >
        <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
          {sortedIssues.map((issue) => (
            <DraggableBoardCard key={issue.id} issue={issue} />
          ))}
        </SortableContext>
        {issues.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            No issues
          </p>
        )}
      </div>
    </div>
  );
}
