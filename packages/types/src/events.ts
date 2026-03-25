import type { Issue } from "./issue.js";
import type { Agent } from "./agent.js";
import type { InboxItem } from "./inbox.js";
import type { Comment } from "./comment.js";
import type { Workspace, MemberWithUser } from "./workspace.js";

// WebSocket event types (matching Go server protocol/events.go)
export type WSEventType =
  | "issue:created"
  | "issue:updated"
  | "issue:deleted"
  | "comment:created"
  | "comment:updated"
  | "comment:deleted"
  | "agent:status"
  | "agent:created"
  | "agent:deleted"
  | "task:dispatch"
  | "task:progress"
  | "task:completed"
  | "task:failed"
  | "inbox:new"
  | "inbox:read"
  | "inbox:archived"
  | "workspace:updated"
  | "member:added"
  | "member:removed"
  | "daemon:heartbeat"
  | "daemon:register";

export interface WSMessage<T = unknown> {
  type: WSEventType;
  payload: T;
}

export interface IssueCreatedPayload {
  issue: Issue;
}

export interface IssueUpdatedPayload {
  issue: Issue;
}

export interface IssueDeletedPayload {
  issue_id: string;
}

export interface AgentStatusPayload {
  agent: Agent;
}

export interface AgentCreatedPayload {
  agent: Agent;
}

export interface AgentDeletedPayload {
  agent_id: string;
  workspace_id: string;
}

export interface InboxNewPayload {
  item: InboxItem;
}

export interface InboxReadPayload {
  item_id: string;
  recipient_id: string;
}

export interface InboxArchivedPayload {
  item_id: string;
  recipient_id: string;
}

export interface CommentCreatedPayload {
  comment: Comment;
}

export interface CommentUpdatedPayload {
  comment: Comment;
}

export interface CommentDeletedPayload {
  comment_id: string;
  issue_id: string;
}

export interface WorkspaceUpdatedPayload {
  workspace: Workspace;
}

export interface MemberAddedPayload {
  member: MemberWithUser;
  workspace_id: string;
}

export interface MemberRemovedPayload {
  member_id: string;
  user_id: string;
  workspace_id: string;
}
