export type InboxSeverity = "action_required" | "attention" | "info";

export type InboxItemType =
  | "issue_assigned"
  | "review_requested"
  | "agent_blocked"
  | "agent_completed"
  | "mentioned"
  | "status_change";

export interface InboxItem {
  id: string;
  workspace_id: string;
  recipient_type: "member" | "agent";
  recipient_id: string;
  type: InboxItemType;
  severity: InboxSeverity;
  issue_id: string | null;
  title: string;
  body: string | null;
  read: boolean;
  archived: boolean;
  created_at: string;
}
