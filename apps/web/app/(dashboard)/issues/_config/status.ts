import type { IssueStatus } from "@multica/types";

export const STATUS_ORDER: IssueStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
];

export const ALL_STATUSES: IssueStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
];

export const STATUS_CONFIG: Record<
  IssueStatus,
  { label: string; iconColor: string; hoverBg: string }
> = {
  backlog: { label: "Backlog", iconColor: "text-muted-foreground", hoverBg: "hover:bg-accent" },
  todo: { label: "Todo", iconColor: "text-muted-foreground", hoverBg: "hover:bg-accent" },
  in_progress: { label: "In Progress", iconColor: "text-yellow-500", hoverBg: "hover:bg-yellow-500/10" },
  in_review: { label: "In Review", iconColor: "text-green-500", hoverBg: "hover:bg-green-500/10" },
  done: { label: "Done", iconColor: "text-blue-500", hoverBg: "hover:bg-blue-500/10" },
  blocked: { label: "Blocked", iconColor: "text-red-500", hoverBg: "hover:bg-red-500/10" },
  cancelled: { label: "Cancelled", iconColor: "text-muted-foreground", hoverBg: "hover:bg-accent" },
};
