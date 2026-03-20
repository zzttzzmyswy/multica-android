import type { Issue, IssueStatus, IssuePriority, IssueAssigneeType } from "./issue.js";

// Issue API
export interface CreateIssueRequest {
  title: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  assignee_type?: IssueAssigneeType;
  assignee_id?: string;
  parent_issue_id?: string;
  acceptance_criteria?: string[];
  context_refs?: string[];
  repository?: { url: string; branch?: string; path?: string };
}

export interface UpdateIssueRequest {
  title?: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  assignee_type?: IssueAssigneeType | null;
  assignee_id?: string | null;
  position?: number;
}

export interface ListIssuesResponse {
  issues: Issue[];
  total: number;
}

// Pagination
export interface PaginationParams {
  limit?: number;
  offset?: number;
}
