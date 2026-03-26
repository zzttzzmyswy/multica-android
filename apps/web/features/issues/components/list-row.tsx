"use client";

import Link from "next/link";
import type { Issue } from "@/shared/types";
import { ActorAvatar } from "@/components/common/actor-avatar";
import { StatusIcon } from "./status-icon";
import { PriorityIcon } from "./priority-icon";

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function ListRow({ issue }: { issue: Issue }) {
  return (
    <Link
      href={`/issues/${issue.id}`}
      className="flex h-9 items-center gap-2 px-4 text-sm transition-colors hover:bg-accent/50"
    >
      <PriorityIcon priority={issue.priority} />
      <span className="w-16 shrink-0 text-xs text-muted-foreground">
        {issue.id.slice(0, 8)}
      </span>
      <StatusIcon status={issue.status} className="h-3.5 w-3.5" />
      <span className="min-w-0 flex-1 truncate">{issue.title}</span>
      {issue.due_date && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDate(issue.due_date)}
        </span>
      )}
      {issue.assignee_type && issue.assignee_id && (
        <ActorAvatar
          actorType={issue.assignee_type}
          actorId={issue.assignee_id}
          size={20}
        />
      )}
    </Link>
  );
}
