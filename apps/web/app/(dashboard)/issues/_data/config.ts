import type { IssueStatus, IssuePriority } from "@multica/types";

export const STATUS_CONFIG: Record<
  IssueStatus,
  { label: string; iconColor: string }
> = {
  backlog: { label: "Backlog", iconColor: "text-muted-foreground" },
  todo: { label: "Todo", iconColor: "text-muted-foreground" },
  in_progress: { label: "In Progress", iconColor: "text-yellow-500" },
  in_review: { label: "In Review", iconColor: "text-blue-500" },
  done: { label: "Done", iconColor: "text-green-500" },
  blocked: { label: "Blocked", iconColor: "text-red-500" },
  cancelled: { label: "Cancelled", iconColor: "text-muted-foreground/50" },
};

export const PRIORITY_CONFIG: Record<
  IssuePriority,
  { label: string; bars: number; color: string }
> = {
  urgent: { label: "Urgent", bars: 4, color: "text-orange-500" },
  high: { label: "High", bars: 3, color: "text-orange-400" },
  medium: { label: "Medium", bars: 2, color: "text-yellow-500" },
  low: { label: "Low", bars: 1, color: "text-blue-400" },
  none: { label: "No priority", bars: 0, color: "text-muted-foreground" },
};
