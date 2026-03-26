"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  closestCenter,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { Issue, IssueStatus } from "@/shared/types";
import { BoardColumn } from "./board-column";
import { BoardCardContent } from "./board-card";

const kanbanCollision: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  if (pointer.length > 0) return pointer;
  return closestCenter(args);
};

export function BoardView({
  issues,
  visibleStatuses,
  onMoveIssue,
}: {
  issues: Issue[];
  visibleStatuses: IssueStatus[];
  onMoveIssue: (issueId: string, newStatus: IssueStatus) => void;
}) {
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const issue = issues.find((i) => i.id === event.active.id);
      if (issue) setActiveIssue(issue);
    },
    [issues]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveIssue(null);
      const { active, over } = event;
      if (!over) return;

      const issueId = active.id as string;
      let targetStatus: IssueStatus | undefined;

      if (visibleStatuses.includes(over.id as IssueStatus)) {
        targetStatus = over.id as IssueStatus;
      } else {
        const targetIssue = issues.find((i) => i.id === over.id);
        if (targetIssue) targetStatus = targetIssue.status;
      }

      if (targetStatus) {
        const currentIssue = issues.find((i) => i.id === issueId);
        if (currentIssue && currentIssue.status !== targetStatus) {
          onMoveIssue(issueId, targetStatus);
        }
      }
    },
    [issues, onMoveIssue, visibleStatuses]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={kanbanCollision}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-1 min-h-0 gap-3 overflow-x-auto p-4">
        {visibleStatuses.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            issues={issues.filter((i) => i.status === status)}
          />
        ))}
      </div>

      <DragOverlay>
        {activeIssue ? (
          <div className="w-64 rotate-1 cursor-grabbing opacity-95 shadow-md">
            <BoardCardContent issue={activeIssue} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
