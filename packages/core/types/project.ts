export type ProjectStatus = "planned" | "in_progress" | "paused" | "completed" | "cancelled";

export type ProjectPriority = "urgent" | "high" | "medium" | "low" | "none";

/**
 * Who may see a project and everything under it (MUL-8472).
 *
 *  - `workspace` — every workspace member
 *  - `private`   — the project's member rows, plus workspace owners/admins
 *
 * An issue's visibility is its project's: there is no per-issue switch.
 */
export type ProjectVisibility = "workspace" | "private";

export interface Project {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  icon: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  lead_type: "member" | "agent" | null;
  lead_id: string | null;
  // Calendar days ("YYYY-MM-DD"), no time-of-day or timezone — same contract as
  // issue.start_date / issue.due_date.
  start_date: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  issue_count: number;
  done_count: number;
  resource_count: number;
  /**
   * The workflow this project uses; null for the workspace Default workflow.
   * Optional because older servers do not send it — the deployed server does
   * (`GET /api/projects` carries it), which is what lets mobile resolve a
   * project's workflow at all. (MUL-7420)
   */
  workflow_id?: string | null;
  /**
   * Who may see this project (MUL-8472). The deployed server always sends it
   * (`project.go` `ProjectResponse.Visibility`); optional here because an
   * older response shape omits it. Read it through `resolveProjectVisibility`,
   * which folds "absent" to `workspace` — never to `private`.
   */
  visibility?: ProjectVisibility;
}

export interface CreateProjectRequest {
  title: string;
  description?: string;
  icon?: string;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  lead_type?: "member" | "agent";
  lead_id?: string;
  start_date?: string;
  due_date?: string;
  // Resources to attach in the same transaction as the project. Server returns
  // 4xx (and rolls back) if any one is invalid or duplicate.
  resources?: CreateProjectResourceRequest[];
  // "private" creates a private project (MUL-8472); member_ids seeds its
  // member list and the creator is always added. Omit for "workspace", which
  // is what the server defaults to.
  visibility?: ProjectVisibility;
  member_ids?: string[];
}

export interface UpdateProjectRequest {
  title?: string;
  description?: string | null;
  icon?: string | null;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  lead_type?: "member" | "agent" | null;
  lead_id?: string | null;
  // Omit the key to leave the date untouched; send null (or "") to clear it.
  start_date?: string | null;
  due_date?: string | null;
  // Switching visibility (MUL-8472). `member_ids` is the complete desired
  // member list when moving to "private" — the server replaces the rows in
  // that direction. Sending `member_ids` without `visibility` is meaningless
  // and the server ignores it; add/remove a single member uses the dedicated
  // `/members` endpoints instead (see data/mutations/project-access.ts).
  visibility?: ProjectVisibility;
  member_ids?: string[];
}

export interface ListProjectsResponse {
  projects: Project[];
  total: number;
}

/**
 * A project's member row (MUL-8472). Distinct from `MemberWithUser` — this is
 * membership OF a project, not of the workspace, and the server adds
 * `workspace_role` so the UI can label owners/admins without a second lookup.
 */
export interface ProjectMember {
  project_id: string;
  user_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  added_by: string | null;
  created_at: string;
  workspace_role?: string;
}

export interface ListProjectMembersResponse {
  members: ProjectMember[];
  total: number;
}

// ProjectResource is a typed pointer from a project to an external resource.
// The resource_ref shape depends on resource_type. New types add a case in
// validateAndNormalizeResourceRef on the server and a renderer in the UI.
//
// Known types (UI must default-case unknown server-side additions):
//   - github_repo: cloud-side git checkout, ref = { url, ref?, default_branch_hint? }
//   - local_directory: agent execution on a specific daemon,
//     ref = { local_path, daemon_id, label?, execution_mode? }
export type ProjectResourceType = "github_repo" | "local_directory";

export interface GithubRepoResourceRef {
  url: string;
  ref?: string;
  default_branch_hint?: string;
}

/**
 * How tasks sharing one local directory are executed.
 *
 * - `in_place`: the agent works directly in the user's directory and tasks run
 *   one at a time — a second task waits in `waiting_local_directory`. Edits
 *   land in the user's working copy.
 * - `worktree`: each task gets its own git worktree of that repo inside the
 *   runtime's workspace, so tasks run concurrently and deliver their work as an
 *   `agent/<agent>/<task>` branch instead of touching the working copy.
 *
 * Absent means `in_place`: resources created before the mode existed keep their
 * original behavior, so this is optional rather than defaulted on the server.
 */
export type LocalDirectoryExecutionMode = "in_place" | "worktree";

export interface LocalDirectoryResourceRef {
  local_path: string;
  daemon_id: string;
  label?: string;
  execution_mode?: LocalDirectoryExecutionMode;
}

export type ProjectResourceRef =
  | GithubRepoResourceRef
  | LocalDirectoryResourceRef
  | Record<string, unknown>;

export interface ProjectResource {
  id: string;
  project_id: string;
  workspace_id: string;
  resource_type: ProjectResourceType;
  resource_ref: ProjectResourceRef;
  label: string | null;
  position: number;
  created_at: string;
  created_by: string | null;
}

export interface CreateProjectResourceRequest {
  resource_type: ProjectResourceType;
  resource_ref: ProjectResourceRef;
  label?: string;
  position?: number;
}

// resource_type is immutable server-side; partial-update payload mirrors that.
// Sending only the field(s) you want to change is fine — the server merges
// the request body with the existing row, including resource_ref shortcuts.
export interface UpdateProjectResourceRequest {
  resource_ref?: ProjectResourceRef;
  label?: string | null;
  position?: number;
}

export interface ListProjectResourcesResponse {
  resources: ProjectResource[];
  total: number;
}
