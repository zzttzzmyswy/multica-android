import type {
  Issue,
  CreateIssueRequest,
  UpdateIssueRequest,
  ListIssuesResponse,
  Agent,
  InboxItem,
  Comment,
  Workspace,
  MemberWithUser,
  User,
} from "@multica/types";

export interface LoginResponse {
  token: string;
  user: User;
}

export class ApiClient {
  private baseUrl: string;
  private token: string | null = null;
  private workspaceId: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setToken(token: string) {
    this.token = token;
  }

  setWorkspaceId(id: string) {
    this.workspaceId = id;
  }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    if (this.workspaceId) {
      headers["X-Workspace-ID"] = this.workspaceId;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }

    // Handle 204 No Content
    if (res.status === 204) {
      return undefined as T;
    }

    return res.json() as Promise<T>;
  }

  // Auth
  async login(email: string, name?: string): Promise<LoginResponse> {
    return this.fetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, name }),
    });
  }

  async getMe(): Promise<User> {
    return this.fetch("/api/me");
  }

  // Issues
  async listIssues(params?: { limit?: number; offset?: number; workspace_id?: string }): Promise<ListIssuesResponse> {
    const search = new URLSearchParams();
    if (params?.limit) search.set("limit", String(params.limit));
    if (params?.offset) search.set("offset", String(params.offset));
    const wsId = params?.workspace_id ?? this.workspaceId;
    if (wsId) search.set("workspace_id", wsId);
    return this.fetch(`/api/issues?${search}`);
  }

  async getIssue(id: string): Promise<Issue> {
    return this.fetch(`/api/issues/${id}`);
  }

  async createIssue(data: CreateIssueRequest): Promise<Issue> {
    const search = new URLSearchParams();
    if (this.workspaceId) search.set("workspace_id", this.workspaceId);
    return this.fetch(`/api/issues?${search}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateIssue(id: string, data: UpdateIssueRequest): Promise<Issue> {
    return this.fetch(`/api/issues/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteIssue(id: string): Promise<void> {
    await this.fetch(`/api/issues/${id}`, { method: "DELETE" });
  }

  // Comments
  async listComments(issueId: string): Promise<Comment[]> {
    return this.fetch(`/api/issues/${issueId}/comments`);
  }

  async createComment(issueId: string, content: string, type?: string): Promise<Comment> {
    return this.fetch(`/api/issues/${issueId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content, type: type ?? "comment" }),
    });
  }

  // Agents
  async listAgents(params?: { workspace_id?: string }): Promise<Agent[]> {
    const search = new URLSearchParams();
    const wsId = params?.workspace_id ?? this.workspaceId;
    if (wsId) search.set("workspace_id", wsId);
    return this.fetch(`/api/agents?${search}`);
  }

  async getAgent(id: string): Promise<Agent> {
    return this.fetch(`/api/agents/${id}`);
  }

  // Inbox
  async listInbox(): Promise<InboxItem[]> {
    return this.fetch("/api/inbox");
  }

  async markInboxRead(id: string): Promise<void> {
    await this.fetch(`/api/inbox/${id}/read`, { method: "POST" });
  }

  async archiveInbox(id: string): Promise<void> {
    await this.fetch(`/api/inbox/${id}/archive`, { method: "POST" });
  }

  // Workspaces
  async listWorkspaces(): Promise<Workspace[]> {
    return this.fetch("/api/workspaces");
  }

  async getWorkspace(id: string): Promise<Workspace> {
    return this.fetch(`/api/workspaces/${id}`);
  }

  async createWorkspace(data: { name: string; slug: string; description?: string }): Promise<Workspace> {
    return this.fetch("/api/workspaces", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateWorkspace(id: string, data: { name?: string; description?: string; settings?: Record<string, unknown> }): Promise<Workspace> {
    return this.fetch(`/api/workspaces/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  // Members
  async listMembers(workspaceId: string): Promise<MemberWithUser[]> {
    return this.fetch(`/api/workspaces/${workspaceId}/members`);
  }
}
