"use client";

import { useDroppable } from "@dnd-kit/core";
import type { Issue, IssueStatus } from "@multica/types";
import { STATUS_CONFIG } from "@/features/issues/config";
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
    <div className="flex min-w-52 flex-1 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <StatusIcon status={status} className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">{cfg.label}</span>
        <span className="text-xs text-muted-foreground">{issues.length}</span>
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
