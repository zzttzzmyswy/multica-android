import type { Issue } from "./issue.js";
import type { Agent } from "./agent.js";
import type { InboxItem } from "./inbox.js";

// WebSocket event types (matching Go server protocol/events.go)
export type WSEventType =
  | "issue:created"
  | "issue:updated"
  | "issue:deleted"
  | "agent:status"
  | "task:dispatch"
  | "task:progress"
  | "task:completed"
  | "task:failed"
  | "inbox:new"
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

export interface InboxNewPayload {
  item: InboxItem;
}
