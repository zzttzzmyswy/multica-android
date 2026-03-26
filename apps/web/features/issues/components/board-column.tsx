"use client";

import { EyeOff, MoreHorizontal, Plus } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import type { Issue, IssueStatus } from "@/shared/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { STATUS_CONFIG } from "@/features/issues/config";
import { useModalStore } from "@/features/modals";
import { useIssueViewStore } from "@/features/issues/stores/view-store";
import { StatusIcon } from "./status-icon";
import { DraggableBoardCard } from "./board-card";

export function BoardColumn({
  status,
  issues,
}: {
  status: IssueStatus;
  issues: Issue[];
}) {
  const cfg = STATUS_CONFIG[status];
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className="flex w-64 shrink-0 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        {/* Left: icon + label + count */}
        <div className="flex items-center gap-2">
          <StatusIcon status={status} className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">{cfg.label}</span>
          <span className="text-xs text-muted-foreground">{issues.length}</span>
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
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full text-muted-foreground"
            onClick={() => useModalStore.getState().open("create-issue", { status })}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={`min-h-[200px] flex-1 space-y-1.5 overflow-y-auto rounded-lg p-1 transition-colors ${
          isOver ? "bg-accent" : ""
        }`}
      >
        {issues.map((issue) => (
          <DraggableBoardCard key={issue.id} issue={issue} />
        ))}
        {issues.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            No issues
          </p>
        )}
      </div>
    </div>
  );
}
