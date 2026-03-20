export type AgentStatus = "idle" | "working" | "blocked" | "error" | "offline";

export type AgentRuntimeMode = "local" | "cloud";

export type AgentVisibility = "workspace" | "private";

export interface Agent {
  id: string;
  workspace_id: string;
  name: string;
  avatar_url: string | null;
  runtime_mode: AgentRuntimeMode;
  runtime_config: Record<string, unknown>;
  visibility: AgentVisibility;
  status: AgentStatus;
  max_concurrent_tasks: number;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}
