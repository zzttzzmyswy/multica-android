/**
 * Mobile-owned fetch wrapper. Mirrors the surface area of
 * packages/core/api/client.ts that mobile actually uses, but lives in
 * apps/mobile/ so we control retry/timeout/error handling independently.
 *
 * Types are imported via `import type` from @multica/core/types — zero
 * runtime coupling. Zod schemas + fallbacks are imported from
 * @multica/core/api/schemas (pure data, on the mobile sharing whitelist).
 *
 * Design checklist (apps/mobile/CLAUDE.md "Lessons → ApiClient capability list"):
 *   1. Zod parseWithFallback for endpoints with schemas (drift defense)
 *   2. onUnauthorized callback on 401 (auto sign-out, avoids retry loops)
 *   3. X-Request-ID per request + structured logger (debug + tracing)
 *   4. Bearer auth + X-Workspace-Slug — NOT cookie auth (no CSRF, no credentials)
 */
import type {
  Agent,
  AgentBuilderRuntimeSwitch,
  AgentBuilderSession,
  AgentBuilderSessionSummary,
  AgentEnvResponse,
  AgentTask,
  Attachment,
  Autopilot,
  AutopilotRun,
  AutopilotTrigger,
  ChatMessage,
  ChatPendingTask,
  ChatSession,
  Comment,
  CreateAgentRequest,
  CreateAutopilotRequest,
  CreateAutopilotTriggerRequest,
  CreateIssueRequest,
  CreateLabelRequest,
  CreateMemberRequest,
  CreatePersonalAccessTokenRequest,
  CreatePersonalAccessTokenResponse,
  CreatePropertyRequest,
  CreateProjectRequest,
  CreateProjectResourceRequest,
  CronPreviewResponse,
  GetAutopilotResponse,
  InboxItem,
  Invitation,
  Issue,
  IssueLabelsResponse,
  IssuePropertiesResponse,
  IssueProperty,
  IssuePropertyValue,
  Label,
  IssueReaction,
  ListAutopilotRunsResponse,
  ListAutopilotsResponse,
  ListIssuesParams,
  ListIssuesResponse,
  ListLabelsResponse,
  ListProjectResourcesResponse,
  ListProjectsResponse,
  ListPropertiesResponse,
  MemberWithUser,
  UpdateMemberRequest,
  PinnedItem,
  PinnedItemType,
  Project,
  ProjectResource,
  Reaction,
  ReorderPinsRequest,
  RuntimeDevice,
  DashboardUsageDaily,
  DashboardUsageByAgent,
  SearchIssuesResponse,
  SearchProjectsResponse,
  SendChatMessageResponse,
  SetAgentSkillsRequest,
  Skill,
  SkillSummary,
  StoredAgentDraft,
  CreateSkillRequest,
  UpdateSkillRequest,
  Squad,
  SquadMember,
  SquadMemberStatusListResponse,
  AddSquadMemberRequest,
  CreateSquadRequest,
  NotificationPreferenceResponse,
  NotificationPreferences,
  PersonalAccessToken,
  RemoveSquadMemberRequest,
  TaskMessagePayload,
  TimelineEntry,
  UpdateAgentEnvRequest,
  UpdateAgentRequest,
  UpdateAutopilotRequest,
  UpdateAutopilotTriggerRequest,
  UpdateIssueRequest,
  UpdateLabelRequest,
  UpdateMeRequest,
  UpdateProjectRequest,
  UpdatePropertyRequest,
  UpdateSquadMemberRoleRequest,
  UpdateSquadRequest,
  User,
  Workspace,
  WorkspaceMcpServer,
  WorkspaceRepo,
} from "@multica/core/types";
import {
  AgentBuilderRuntimeSwitchSchema,
  AgentBuilderSessionListSchema,
  AgentBuilderSessionSchema,
  AutopilotRunSchema,
  EMPTY_AGENT_BUILDER_SESSION,
  EMPTY_AGENT_BUILDER_SESSION_LIST,
  EMPTY_ISSUE_PROPERTY,
  EMPTY_ISSUE_PROPERTIES_RESPONSE,
  EMPTY_LIST_AUTOPILOTS_RESPONSE,
  EMPTY_LIST_ISSUES_RESPONSE,
  EMPTY_LIST_PROPERTIES_RESPONSE,
  EMPTY_SQUAD,
  EMPTY_TIMELINE_ENTRIES,
  FALLBACK_AUTOPILOT_RUN,
  IssuePropertiesResponseSchema,
  IssuePropertySchema,
  IssueSchema,
  ListAutopilotsResponseSchema,
  ListIssuesResponseSchema,
  ListPropertiesResponseSchema,
  TimelineEntriesSchema,
  agentBuilderRuntimeSwitchFallback,
} from "@multica/core/api/schemas";
import {
  ActiveTasksResponseSchema,
  AgentEnvSchema,
  AgentListSchema,
  AgentTaskListSchema,
  AutopilotDetailSchema,
  AutopilotTriggerSchema,
  AttachmentListSchema,
  AttachmentSchema,
  ChatMessageListSchema,
  CommentSchema,
  ChatPendingTaskSchema,
  ChatSessionListSchema,
  ChatSessionSchema,
  ChildIssuesResponseSchema,
  CreatePersonalAccessTokenResponseSchema,
  CronPreviewResponseSchema,
  DashboardUsageDailyListSchema,
  DashboardUsageByAgentListSchema,
  EMPTY_ACTIVE_TASKS_RESPONSE,
  EMPTY_AGENT_ENV,
  EMPTY_AGENT_LIST,
  EMPTY_AGENT_TASK_LIST,
  EMPTY_AUTOPILOT_DETAIL,
  EMPTY_AUTOPILOT_TRIGGER,
  EMPTY_ATTACHMENT_LIST,
  EMPTY_CHAT_MESSAGE_LIST,
  EMPTY_CHAT_PENDING_TASK,
  EMPTY_CHAT_SESSION_LIST,
  EMPTY_CHILD_ISSUES_RESPONSE,
  EMPTY_COMMENT,
  EMPTY_CRON_PREVIEW_RESPONSE,
  EMPTY_INBOX_LIST,
  EMPTY_INVITATION_LIST,
  EMPTY_ISSUE_FALLBACK,
  EMPTY_LIST_AUTOPILOT_RUNS_RESPONSE,
  EMPTY_LABEL,
  EMPTY_LIST_LABELS_RESPONSE,
  EMPTY_LIST_PROJECT_RESOURCES_RESPONSE,
  EMPTY_LIST_PROJECTS_RESPONSE,
  EMPTY_MEMBER_LIST,
  EMPTY_NOTIFICATION_PREFERENCES,
  EMPTY_PIN_LIST,
  EMPTY_PROJECT,
  EMPTY_RUNTIME_LIST,
  EMPTY_SEARCH_ISSUES_RESPONSE,
  EMPTY_SEARCH_PROJECTS_RESPONSE,
  EMPTY_SQUAD_LIST,
  EMPTY_USER,
  EMPTY_WORKSPACE_LIST,
  InboxListSchema,
  InvitationListSchema,
  NotificationPreferenceResponseSchema,
  ListAutopilotRunsResponseSchema,
  ListLabelsResponseSchema,
  LabelSchema,
  ListProjectResourcesResponseSchema,
  ListProjectsResponseSchema,
  MemberListSchema,
  PersonalAccessTokenListSchema,
  PinListSchema,
  PinnedItemSchema,
  ProjectSchema,
  RuntimeListSchema,
  SearchIssuesResponseSchema,
  SearchProjectsResponseSchema,
  SendChatMessageResponseSchema,
  SkillListSchema,
  EMPTY_SKILL_LIST,
  SkillSchema,
  EMPTY_SKILL,
  SquadListSchema,
  SquadSchema,
  SquadMemberListSchema,
  SquadMemberStatusListResponseSchema,
  EMPTY_SQUAD_MEMBER_LIST,
  EMPTY_SQUAD_MEMBER_STATUS_LIST,
  TaskMessageListSchema,
  EMPTY_TASK_MESSAGE_LIST,
  UserSchema,
  WorkspaceListSchema,
  WorkspaceMcpServerSchema,
  WorkspaceMcpServerListSchema,
  EMPTY_WORKSPACE_MCP_SERVER,
  EMPTY_WORKSPACE_MCP_SERVER_LIST,
} from "./schemas";
import type { ZodType } from "zod";
import { File, Paths } from "expo-file-system";
import { createDownloadResumable } from "expo-file-system/legacy";
import { getCurrentSlug } from "./workspace-store";
import { getApiBaseUrl, getEnvBaseUrl, setApiBaseUrl } from "./server-config";
import { parseWithFallback } from "@/lib/parse-response";
import { createRequestId } from "@/lib/request-id";
import { resolveAttachmentUrl } from "@/lib/attachment-url";
import { sanitizeBasename } from "@/lib/attachment-download";

if (!getEnvBaseUrl()) {
  throw new Error(
    "EXPO_PUBLIC_API_URL is not set. Add it to apps/mobile/.env.development.local " +
      "(see apps/mobile/.env.staging for an example).",
  );
}

export interface LoginResponse {
  token: string;
  user: User;
}

/** Mobile file payload for `uploadFile`. RN doesn't have a browser `File`
 *  object; the fetch `FormData` polyfill accepts `{ uri, name, type }`
 *  directly and streams from disk. expo-image-picker / expo-document-picker
 *  return assets that map straight onto this shape. */
export interface FileAsset {
  uri: string;
  name: string;
  type: string;
}

/** PATCH /api/workspaces/{id} body — mirrors the param shape of
 *  packages/core/api/client.ts:updateWorkspace. The server trims `name`
 *  and rejects an empty one with 400 "name is required"; a non-empty
 *  rename also notifies the daemon + pushes EventWorkspaceUpdated. */
export interface UpdateWorkspaceRequest {
  name?: string;
  description?: string;
  context?: string;
  settings?: Record<string, unknown>;
  repos?: WorkspaceRepo[];
  issue_prefix?: string;
  avatar_url?: string;
}

/** Result of `ApiClient.downloadFile` — a local copy of an attachment's
 *  bytes written to the app cache, ready to hand to a system viewer/share
 *  sheet. The original remote URL and auth are not echoed back. */
export interface LocalDownload {
  /** `file://` URI of the downloaded bytes on the device. */
  uri: string;
  /** The safe basename written to cache (derived from the requested name). */
  name: string;
}

/** Web mirrors this from `packages/core/constants/upload.ts`. Mobile keeps
 *  its own copy per the `mirror, don't import` rule in apps/mobile/CLAUDE.md. */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

/** Hard ceiling for every HTTP request. Mobile-specific because iOS may
 *  suspend a backgrounded network task without ever resolving/rejecting
 *  the JS-side fetch promise (facebook/react-native#35384). Without this
 *  timeout, a refetch fired after returning to foreground can leave the
 *  query stuck in `isRefetching` state forever (visible as the
 *  pull-to-refresh spinner never going away). 30s is generous for any
 *  reasonable Multica payload size on cellular. */
const FETCH_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  readonly status: number;
  readonly body?: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** Raised when a progress-tracked download is aborted by the user (or the
 *  task is superseded). Callers that record a download history map this to
 *  the "cancelled" terminal state instead of a failure. */
export class DownloadCancelledError extends Error {
  constructor() {
    super("Download cancelled");
    this.name = "DownloadCancelledError";
  }
}

export interface ApiClientOptions {
  /** Called once when the server returns 401. The platform layer wires this
   *  to clear the token + navigate to /login so a stale token doesn't keep
   *  every subsequent request looping on 401. */
  onUnauthorized?: () => void;
}

class ApiClient {
  private token: string | null = null;
  private options: ApiClientOptions = {};

  setToken(token: string | null) {
    this.token = token;
  }

  setOptions(options: ApiClientOptions) {
    this.options = { ...this.options, ...options };
  }

  /** Point the app at a different Multica server at runtime. Persists the
   *  override and makes it effective immediately — the underlying fetch chain
   *  re-reads `getApiBaseUrl()` per request, and the realtime socket rebuilds
   *  on the change notification. Rejects with a validation error on a
   *  non-http(s) / hostless URL. */
  async setBaseUrl(url: string): Promise<void> {
    await setApiBaseUrl(url);
  }

  private async fetch<T>(
    path: string,
    init: RequestInit & { signal?: AbortSignal } = {},
  ): Promise<T> {
    const rid = createRequestId();
    const start = Date.now();
    const method = init.method ?? "GET";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Client-Platform": "mobile",
      "X-Client-OS": "ios",
      "X-Client-Version": "0.1.0",
      "X-Request-ID": rid,
      ...((init.headers as Record<string, string>) ?? {}),
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    // Backend middleware (server/internal/middleware/workspace.go) resolves
    // slug → ws UUID and gates membership. Mirrors packages/core/api/client.ts.
    const slug = getCurrentSlug();
    if (slug && !headers["X-Workspace-Slug"]) {
      headers["X-Workspace-Slug"] = slug;
    }

    // Timeout + caller-signal forwarding.
    //
    // Hermes does NOT support AbortSignal.timeout() or AbortSignal.any() —
    // see facebook/react-native#42042 and livekit#4014. So we manually
    // compose a single controller that aborts on:
    //   (a) caller-side signal (TQ cancelling a stale/inactive query, etc),
    //   (b) 30s timeout (defends against iOS suspending the network task
    //       silently during background — fetch() then never resolves;
    //       facebook/react-native#35384). Without this, a refetch
    //       triggered by WS reconnect can leave the FlatList pull-to-refresh
    //       spinner stuck on the screen indefinitely.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`request timed out after ${FETCH_TIMEOUT_MS}ms`));
    }, FETCH_TIMEOUT_MS);
    const callerSignal = init.signal;
    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort(callerSignal.reason);
      else callerSignal.addEventListener("abort", onCallerAbort);
    }

    console.log(`[api] → ${method} ${path}`, { rid });

    let res: Response;
    try {
      res = await fetch(`${getApiBaseUrl()}${path}`, {
        ...init,
        signal: controller.signal,
        headers,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener("abort", onCallerAbort);
      // Re-throw with a clearer message if this was our own timeout abort.
      if (
        err instanceof Error &&
        err.name === "AbortError" &&
        !callerSignal?.aborted
      ) {
        const duration = Date.now() - start;
        console.warn(`[api] ← TIMEOUT ${path}`, {
          rid,
          duration: `${duration}ms`,
        });
        throw new ApiError(
          `Request timed out after ${FETCH_TIMEOUT_MS}ms`,
          0,
          undefined,
        );
      }
      throw err;
    }
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", onCallerAbort);
    const duration = Date.now() - start;

    if (!res.ok) {
      // 401 sign-out hook: invoke once, let the platform layer (auth-store)
      // clear the token + navigate. Subsequent requests in flight will also
      // 401 and re-enter here, so the callback must be idempotent.
      if (res.status === 401) {
        this.options.onUnauthorized?.();
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      const message =
        (body && typeof body === "object" && "message" in body
          ? String((body as { message: unknown }).message)
          : null) ?? `${res.status} ${res.statusText}`;

      const level = res.status === 404 ? "warn" : "error";
      console[level](`[api] ← ${res.status} ${path}`, {
        rid,
        duration: `${duration}ms`,
        error: message,
      });

      throw new ApiError(message, res.status, body);
    }

    console.log(`[api] ← ${res.status} ${path}`, {
      rid,
      duration: `${duration}ms`,
    });

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /**
   * Read-side helper: GET + zod parse + fallback in one call. Collapses
   * the boilerplate that every list/detail endpoint repeats:
   *
   *   const raw = await this.fetch<unknown>(path, { signal: opts?.signal });
   *   return parseWithFallback(raw, Schema, FALLBACK, { endpoint: "name" });
   *
   * Always uses GET (no method arg) — write endpoints that need parsing
   * still go through `this.fetch` + `parseWithFallback` directly because
   * they carry a body and care about method semantics. Use
   * `fetchValidatedWith` for those (PATCH / PUT / POST).
   *
   * The `endpoint` label defaults to the request path — override only when
   * the path has dynamic segments and you want stable telemetry labels.
   */
  private async fetchValidated<T>(
    path: string,
    schema: ZodType,
    fallback: T,
    opts?: { signal?: AbortSignal; endpoint?: string },
  ): Promise<T> {
    const raw = await this.fetch<unknown>(path, { signal: opts?.signal });
    return parseWithFallback(raw, schema, fallback, {
      endpoint: opts?.endpoint ?? path,
    });
  }

  /** Same as fetchValidated but supports any HTTP method + body. Used by
   *  PATCH/PUT/POST endpoints whose response we still want to validate
   *  (e.g. updateMe returns User, updateNotificationPreferences returns
   *  NotificationPreferenceResponse). */
  private async fetchValidatedWith<T>(
    path: string,
    schema: ZodType,
    fallback: T,
    init: RequestInit,
    opts?: { signal?: AbortSignal; endpoint?: string },
  ): Promise<T> {
    // `opts.signal` wins if both are passed, but absent opts.signal does
    // NOT clear init.signal — important because forgetting `?? init.signal`
    // would silently strip a caller's abort signal when they used the
    // RequestInit shape but no opts.
    const raw = await this.fetch<unknown>(path, {
      ...init,
      signal: opts?.signal ?? init.signal ?? undefined,
    });
    return parseWithFallback(raw, schema, fallback, {
      endpoint: opts?.endpoint ?? `${init.method ?? "GET"} ${path}`,
    });
  }

  // --- Auth ---
  async sendCode(email: string): Promise<void> {
    await this.fetch<void>("/auth/send-code", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  async verifyCode(email: string, code: string): Promise<LoginResponse> {
    return this.fetch<LoginResponse>("/auth/verify-code", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    });
  }

  async getMe(opts?: { signal?: AbortSignal }): Promise<User> {
    return this.fetchValidated(
      "/api/me",
      UserSchema,
      EMPTY_USER,
      { ...opts, endpoint: "getMe" },
    );
  }

  // PATCH /api/me — name, avatar_url, language. Server returns the updated
  // user; we parse so a partial drift doesn't bleed into the auth store.
  async updateMe(data: UpdateMeRequest): Promise<User> {
    return this.fetchValidatedWith(
      "/api/me",
      UserSchema,
      EMPTY_USER,
      { method: "PATCH", body: JSON.stringify(data) },
      { endpoint: "updateMe" },
    );
  }

  // --- Notification preferences ---
  async getNotificationPreferences(
    opts?: { signal?: AbortSignal },
  ): Promise<NotificationPreferenceResponse> {
    return this.fetchValidated(
      "/api/notification-preferences",
      NotificationPreferenceResponseSchema,
      EMPTY_NOTIFICATION_PREFERENCES,
      { ...opts, endpoint: "getNotificationPreferences" },
    );
  }

  async updateNotificationPreferences(
    preferences: NotificationPreferences,
    workspaceSlug?: string,
  ): Promise<NotificationPreferenceResponse> {
    return this.fetchValidatedWith(
      "/api/notification-preferences",
      NotificationPreferenceResponseSchema,
      EMPTY_NOTIFICATION_PREFERENCES,
      {
        method: "PATCH",
        headers: workspaceSlug
          ? { "X-Workspace-Slug": workspaceSlug }
          : undefined,
        body: JSON.stringify({ preferences }),
      },
      { endpoint: "updateNotificationPreferences" },
    );
  }

  // --- Workspaces ---
  async listWorkspaces(opts?: {
    signal?: AbortSignal;
  }): Promise<Workspace[]> {
    const raw = await this.fetch<unknown>("/api/workspaces", {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, WorkspaceListSchema, EMPTY_WORKSPACE_LIST, {
      endpoint: "listWorkspaces",
    });
  }

  // Workspace read/write endpoints — all mirror packages/core/api/client.ts
  // (getWorkspace: client.ts:2258, updateWorkspace: 2260, leaveWorkspace:
  // 2472, deleteWorkspace: 2509). The write endpoints follow the write-endpoint
  // rule (raw fetch — a malformed response surfaces naturally so the caller's
  // error path owns the feedback). `name` is trimmed by the server and an
  // empty one returns 400.
  async getWorkspace(
    workspaceId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<Workspace> {
    return this.fetch<Workspace>(`/api/workspaces/${workspaceId}`, {
      signal: opts?.signal,
    });
  }

  async updateWorkspace(
    workspaceId: string,
    data: UpdateWorkspaceRequest,
  ): Promise<Workspace> {
    return this.fetch<Workspace>(`/api/workspaces/${workspaceId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async leaveWorkspace(workspaceId: string): Promise<void> {
    await this.fetch<void>(`/api/workspaces/${workspaceId}/leave`, {
      method: "POST",
    });
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.fetch<void>(`/api/workspaces/${workspaceId}`, {
      method: "DELETE",
    });
  }

  // --- Inbox ---
  async listInbox(opts?: { signal?: AbortSignal }): Promise<InboxItem[]> {
    const raw = await this.fetch<unknown>("/api/inbox", {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, InboxListSchema, EMPTY_INBOX_LIST, {
      endpoint: "listInbox",
    });
  }

  async markInboxRead(id: string): Promise<InboxItem> {
    return this.fetch<InboxItem>(`/api/inbox/${id}/read`, { method: "POST" });
  }

  // Archive endpoints — write surface. Match web's surface in
  // packages/core/api/client.ts:981-1003. No parseWithFallback (mirrors
  // markInboxRead above and the project write endpoints): a malformed
  // archive response should surface naturally so the optimistic patch
  // rolls back.
  async archiveInbox(id: string): Promise<InboxItem> {
    return this.fetch<InboxItem>(`/api/inbox/${id}/archive`, { method: "POST" });
  }

  async markAllInboxRead(): Promise<{ count: number }> {
    return this.fetch<{ count: number }>("/api/inbox/mark-all-read", {
      method: "POST",
    });
  }

  async archiveAllInbox(): Promise<{ count: number }> {
    return this.fetch<{ count: number }>("/api/inbox/archive-all", {
      method: "POST",
    });
  }

  async archiveAllReadInbox(): Promise<{ count: number }> {
    return this.fetch<{ count: number }>("/api/inbox/archive-all-read", {
      method: "POST",
    });
  }

  async archiveCompletedInbox(): Promise<{ count: number }> {
    return this.fetch<{ count: number }>("/api/inbox/archive-completed", {
      method: "POST",
    });
  }

  // --- Members & Agents (for actor name/avatar lookup) ---
  async listMembers(
    workspaceId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<MemberWithUser[]> {
    const raw = await this.fetch<unknown>(
      `/api/workspaces/${workspaceId}/members`,
      { signal: opts?.signal },
    );
    return parseWithFallback(raw, MemberListSchema, EMPTY_MEMBER_LIST, {
      endpoint: "listMembers",
    });
  }

  // Workspace member write endpoints — mirror
  // packages/core/api/client.ts:2449-2467. Write endpoints follow the
  // write-endpoint rule (raw fetch — a malformed response surfaces
  // naturally so the caller's error path owns the feedback).
  async updateMemberRole(
    workspaceId: string,
    memberId: string,
    data: UpdateMemberRequest,
  ): Promise<MemberWithUser> {
    return this.fetch<MemberWithUser>(
      `/api/workspaces/${workspaceId}/members/${memberId}`,
      { method: "PATCH", body: JSON.stringify(data) },
    );
  }

  async removeMember(
    workspaceId: string,
    memberId: string,
  ): Promise<void> {
    await this.fetch<void>(`/api/workspaces/${workspaceId}/members/${memberId}`, {
      method: "DELETE",
    });
  }

  async inviteMember(
    workspaceId: string,
    data: CreateMemberRequest,
  ): Promise<Invitation> {
    return this.fetch<Invitation>(`/api/workspaces/${workspaceId}/members`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Workspace invitation reads/writes — mirror
  // packages/core/api/client.ts:2483-2490. The list is the pending-invitation
  // feed for the members page; reads parse with a drift-safe schema.
  async listWorkspaceInvitations(
    workspaceId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<Invitation[]> {
    const raw = await this.fetch<unknown>(
      `/api/workspaces/${workspaceId}/invitations`,
      { signal: opts?.signal },
    );
    return parseWithFallback(raw, InvitationListSchema, EMPTY_INVITATION_LIST, {
      endpoint: "listWorkspaceInvitations",
    });
  }

  async revokeInvitation(
    workspaceId: string,
    invitationId: string,
  ): Promise<void> {
    await this.fetch<void>(
      `/api/workspaces/${workspaceId}/invitations/${invitationId}`,
      { method: "DELETE" },
    );
  }

  async listAgents(opts?: {
    signal?: AbortSignal;
    includeArchived?: boolean;
  }): Promise<Agent[]> {
    const qs = opts?.includeArchived ? "?include_archived=true" : "";
    const raw = await this.fetch<unknown>(`/api/agents${qs}`, {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, AgentListSchema, EMPTY_AGENT_LIST, {
      endpoint: "listAgents",
    });
  }

  // POST /api/agents — mirrors packages/core/api/client.ts:1226. Write
  // endpoint per the mobile write-endpoint rule (raw fetch — a malformed
  // response surfaces naturally so the create form's error path owns the
  // feedback; the returned id drives navigation to the detail screen). The
  // server answers 409 on a duplicate name, 400 on >255-char description or
  // a missing runtime — the form classifies these (duplicate → name field,
  // others → form-level alert).
  async createAgent(data: CreateAgentRequest): Promise<Agent> {
    return this.fetch<Agent>("/api/agents", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // PUT /api/agents/{id} — mirrors packages/core/api/client.ts:1341. Write
  // endpoint per the mobile write-endpoint rule (raw fetch; a malformed
  // response surfaces naturally so the edit form owns error feedback). The
  // server answers 400 on a >255-char description / bad thinking token and
  // 403 when a non-owner tries to change access fields (the edit form omits
  // those for non-owners).
  async updateAgent(id: string, data: UpdateAgentRequest): Promise<Agent> {
    return this.fetch<Agent>(`/api/agents/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async archiveAgent(id: string): Promise<Agent> {
    return this.fetch<Agent>(`/api/agents/${id}/archive`, { method: "POST" });
  }

  async restoreAgent(id: string): Promise<Agent> {
    return this.fetch<Agent>(`/api/agents/${id}/restore`, { method: "POST" });
  }

  // GET /api/agents/{id}/env — the dedicated env endpoint (MUL-2600). Unlike
  // web, mobile never auto-fetches this on mount: every call writes an
  // `agent_env_revealed` audit row server-side, so the reveal is intentional
  // (the env screen gates it behind a Reveal action).
  async getAgentEnv(id: string): Promise<AgentEnvResponse> {
    const raw = await this.fetch<unknown>(`/api/agents/${id}/env`);
    return parseWithFallback(raw, AgentEnvSchema, EMPTY_AGENT_ENV, {
      endpoint: "getAgentEnv",
    });
  }

  // PUT /api/agents/{id}/env — wholesale custom_env replace. Values equal to
  // "****" are preserved server-side (the sentinel guard), so a masked map
  // round-trip can never clobber real secrets.
  async updateAgentEnv(
    id: string,
    data: UpdateAgentEnvRequest,
  ): Promise<AgentEnvResponse> {
    const raw = await this.fetch<unknown>(`/api/agents/${id}/env`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return parseWithFallback(raw, AgentEnvSchema, EMPTY_AGENT_ENV, {
      endpoint: "updateAgentEnv",
    });
  }

  // PUT /api/agents/{id}/skills — wholesale skill replace for the edit form.
  async setAgentSkills(
    agentId: string,
    data: SetAgentSkillsRequest,
  ): Promise<void> {
    await this.fetch<void>(`/api/agents/${agentId}/skills`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  // Agent-builders: creation conversations (web Creation Studio). Mirrors
  // packages/core/api/client.ts:1262-1339. The first POST creates the hidden
  // carrier session; GET lists the caller's unfinished ones (404 on an older
  // backend degrades to no drafts, matching listChatDraftRestores); PUT saves
  // the arrived-at configuration; PATCH rebinds the live conversation's
  // execution runtime.
  async createAgentBuilderSession(data: {
    runtime_id: string;
    model?: string;
  }): Promise<AgentBuilderSession> {
    const raw = await this.fetch<unknown>("/api/agent-builder/sessions", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return parseWithFallback(
      raw,
      AgentBuilderSessionSchema,
      EMPTY_AGENT_BUILDER_SESSION,
      { endpoint: "POST /api/agent-builder/sessions" },
    );
  }

  async listAgentBuilderSessions(): Promise<AgentBuilderSessionSummary[]> {
    let raw: unknown;
    try {
      raw = await this.fetch<unknown>("/api/agent-builder/sessions");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return [];
      throw err;
    }
    return parseWithFallback(
      raw,
      AgentBuilderSessionListSchema,
      EMPTY_AGENT_BUILDER_SESSION_LIST,
      { endpoint: "GET /api/agent-builder/sessions" },
    ).sessions;
  }

  async saveAgentBuilderDraft(
    sessionId: string,
    draft: StoredAgentDraft,
  ): Promise<void> {
    await this.fetch(`/api/agent-builder/sessions/${sessionId}/draft`, {
      method: "PUT",
      body: JSON.stringify({ draft }),
    });
  }

  async switchAgentBuilderRuntime(
    sessionId: string,
    data: { runtime_id: string },
  ): Promise<AgentBuilderRuntimeSwitch> {
    const raw = await this.fetch<unknown>(
      `/api/agent-builder/sessions/${sessionId}/runtime`,
      { method: "PATCH", body: JSON.stringify(data) },
    );
    return parseWithFallback(
      raw,
      AgentBuilderRuntimeSwitchSchema,
      agentBuilderRuntimeSwitchFallback(data.runtime_id),
      { endpoint: "PATCH /api/agent-builder/sessions/:id/runtime" },
    );
  }

  // Workspace runtimes — feeds the presence dot's availability dimension
  // (runtime.status + last_seen_at). Backend route registered in
  // server/cmd/server/router.go:514 (GET /api/runtimes).
  async listRuntimes(opts?: { signal?: AbortSignal }): Promise<RuntimeDevice[]> {
    const raw = await this.fetch<unknown>("/api/runtimes", {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, RuntimeListSchema, EMPTY_RUNTIME_LIST, {
      endpoint: "listRuntimes",
    });
  }

  // Workspace usage rollups — mirror packages/core/dashboard queries. Workspace
  // is resolved by the X-Workspace-Slug header (fetch adds it); the 30s
  // in-flight cap applies like every other route. Parsing degrades a drift
  // response to [] so a changed backend never crashes the page.
  async getDashboardUsageDaily(
    days: number,
    opts?: { signal?: AbortSignal },
  ): Promise<DashboardUsageDaily[]> {
    const raw = await this.fetch<unknown>(`/api/dashboard/usage/daily?days=${days}`, {
      signal: opts?.signal,
    });
    return parseWithFallback(
      raw,
      DashboardUsageDailyListSchema,
      [],
      { endpoint: "getDashboardUsageDaily" },
    );
  }

  async getDashboardUsageByAgent(
    days: number,
    opts?: { signal?: AbortSignal },
  ): Promise<DashboardUsageByAgent[]> {
    const raw = await this.fetch<unknown>(`/api/dashboard/usage/by-agent?days=${days}`, {
      signal: opts?.signal,
    });
    return parseWithFallback(
      raw,
      DashboardUsageByAgentListSchema,
      [],
      { endpoint: "getDashboardUsageByAgent" },
    );
  }

  // Workspace-wide active agent tasks + each agent's most recent terminal —
  // feeds the workload dimension of presence (currently unused in the mobile
  // dot; reserved for the P1 long-press peek sheet). Listed here now so the
  // realtime invalidation path can be wired in one PR. Backend route at
  // server/cmd/server/router.go:539 (GET /api/agent-task-snapshot).
  async listAgentTaskSnapshot(
    opts?: { signal?: AbortSignal },
  ): Promise<AgentTask[]> {
    const raw = await this.fetch<unknown>("/api/agent-task-snapshot", {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, AgentTaskListSchema, EMPTY_AGENT_TASK_LIST, {
      endpoint: "listAgentTaskSnapshot",
    });
  }

  async listSquads(opts?: { signal?: AbortSignal }): Promise<Squad[]> {
    const raw = await this.fetch<unknown>("/api/squads", {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, SquadListSchema, EMPTY_SQUAD_LIST, {
      endpoint: "listSquads",
    });
  }

  // --- Squad write / detail endpoints — mirror
  // packages/core/api/client.ts:3438-3496. Reads parse with drift-safe
  // schemas; writes follow the write-endpoint rule (raw fetch — a malformed
  // response surfaces naturally so the caller's error path owns feedback).
  async getSquad(id: string): Promise<Squad> {
    const raw = await this.fetch<unknown>(`/api/squads/${id}`);
    return parseWithFallback(raw, SquadSchema, EMPTY_SQUAD, {
      endpoint: "getSquad",
    });
  }

  async createSquad(data: CreateSquadRequest): Promise<Squad> {
    const raw = await this.fetch<unknown>("/api/squads", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return parseWithFallback(raw, SquadSchema, EMPTY_SQUAD, {
      endpoint: "createSquad",
    });
  }

  async updateSquad(
    id: string,
    data: UpdateSquadRequest,
  ): Promise<Squad> {
    const raw = await this.fetch<unknown>(`/api/squads/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return parseWithFallback(raw, SquadSchema, EMPTY_SQUAD, {
      endpoint: "updateSquad",
    });
  }

  async deleteSquad(id: string): Promise<void> {
    await this.fetch<void>(`/api/squads/${id}`, { method: "DELETE" });
  }

  async listSquadMembers(squadId: string): Promise<SquadMember[]> {
    const raw = await this.fetch<unknown>(`/api/squads/${squadId}/members`);
    return parseWithFallback(raw, SquadMemberListSchema, EMPTY_SQUAD_MEMBER_LIST, {
      endpoint: "listSquadMembers",
    });
  }

  async addSquadMember(
    squadId: string,
    data: AddSquadMemberRequest,
  ): Promise<SquadMember> {
    return this.fetch<SquadMember>(`/api/squads/${squadId}/members`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async removeSquadMember(
    squadId: string,
    data: RemoveSquadMemberRequest,
  ): Promise<void> {
    await this.fetch<void>(`/api/squads/${squadId}/members`, {
      method: "DELETE",
      body: JSON.stringify(data),
    });
  }

  async updateSquadMemberRole(
    squadId: string,
    data: UpdateSquadMemberRoleRequest,
  ): Promise<SquadMember> {
    return this.fetch<SquadMember>(`/api/squads/${squadId}/members/role`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async getSquadMemberStatus(
    squadId: string,
  ): Promise<SquadMemberStatusListResponse> {
    const raw = await this.fetch<unknown>(`/api/squads/${squadId}/members/status`);
    return parseWithFallback(
      raw,
      SquadMemberStatusListResponseSchema,
      EMPTY_SQUAD_MEMBER_STATUS_LIST,
      { endpoint: "getSquadMemberStatus" },
    );
  }

  // --- Issues ---
  async listIssues(
    params: ListIssuesParams = {},
    opts?: { signal?: AbortSignal },
  ): Promise<ListIssuesResponse> {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue;
      if (Array.isArray(v)) {
        // Backend parses comma-separated lists (server/internal/handler/issue.go
        // uses strings.Split on a single query value). Match web's serialization
        // in packages/core/api/client.ts:407 — repeated keys would silently
        // collapse to the first value only.
        if (v.length > 0) search.set(k, v.map(String).join(","));
      } else {
        search.set(k, String(v));
      }
    }
    const qs = search.toString();
    const raw = await this.fetch<unknown>(
      `/api/issues${qs ? `?${qs}` : ""}`,
      { signal: opts?.signal },
    );
    return parseWithFallback(raw, ListIssuesResponseSchema, EMPTY_LIST_ISSUES_RESPONSE, {
      endpoint: "GET /api/issues",
    });
  }

  /** Workspace-wide issue search. Backend `GET /api/issues/search` with
   *  workspace resolved by the `X-Workspace-Slug` middleware (same as
   *  `listIssues`). Caller passes its own `AbortController.signal` so the
   *  search modal can cancel an in-flight request when the user types
   *  again — see app/(app)/[workspace]/search.tsx. */
  async searchIssues(
    params: { q: string; limit?: number; include_closed?: boolean; offset?: number },
    opts?: { signal?: AbortSignal },
  ): Promise<SearchIssuesResponse> {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue;
      search.set(k, String(v));
    }
    const raw = await this.fetch<unknown>(
      `/api/issues/search?${search.toString()}`,
      { signal: opts?.signal },
    );
    return parseWithFallback(raw, SearchIssuesResponseSchema, EMPTY_SEARCH_ISSUES_RESPONSE, {
      endpoint: "GET /api/issues/search",
    });
  }

  async getIssue(
    id: string,
    opts?: { signal?: AbortSignal },
  ): Promise<Issue> {
    return this.fetchValidated(
      `/api/issues/${id}`,
      IssueSchema,
      EMPTY_ISSUE_FALLBACK,
      { ...opts, endpoint: "getIssue" },
    );
  }

  // Write endpoint — mirrors POST /api/issues
  // (server/cmd/server/router.go:320, server/internal/handler/issue.go
  // CreateIssue). Mobile sends only the fields the form fills in; backend
  // applies its own defaults for anything omitted.
  async createIssue(body: CreateIssueRequest): Promise<Issue> {
    return this.fetch<Issue>("/api/issues", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // Timeline returns the full ASC entry list in one shot — server-side
  // pagination was dropped in #2322 (p99 ~30 entries per issue, cursors
  // were pure overhead and split reply threads at page boundaries).
  // Call WITHOUT pagination params: the legacy `limit/before/after/around`
  // path returns the old wrapped shape for back-compat, which mobile must
  // NOT trigger. See server/internal/handler/activity.go:60-69.
  async listTimeline(
    issueId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<TimelineEntry[]> {
    return this.fetchValidated(
      `/api/issues/${issueId}/timeline`,
      TimelineEntriesSchema,
      EMPTY_TIMELINE_ENTRIES,
      { ...opts, endpoint: "GET /api/issues/:id/timeline" },
    );
  }

  // GET /api/issues/:id/attachments — list of file attachments hooked to
  // the issue (or its comments). Mobile uses this to resolve `mc://file/<id>`
  // markdown image URIs to their `download_url` HTTPS endpoint; without it,
  // iOS image loader doesn't understand the mc: scheme and renders broken.
  async listAttachments(
    issueId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<Attachment[]> {
    return this.fetchValidated(
      `/api/issues/${issueId}/attachments`,
      AttachmentListSchema,
      EMPTY_ATTACHMENT_LIST,
      { ...opts, endpoint: "GET /api/issues/:id/attachments" },
    );
  }

  // Active tasks for an issue (status in queued/dispatched/running). Returns
  // the inner `tasks` array directly — handler wraps it in `{ tasks: [] }`
  // (server/internal/handler/daemon.go:1866) so the response object survives
  // future field additions without breaking the cache shape.
  async listActiveTasksForIssue(
    issueId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<AgentTask[]> {
    const parsed = await this.fetchValidated(
      `/api/issues/${issueId}/active-task`,
      ActiveTasksResponseSchema,
      EMPTY_ACTIVE_TASKS_RESPONSE,
      { ...opts, endpoint: "GET /api/issues/:id/active-task" },
    );
    return parsed.tasks;
  }

  // All tasks (any status) for an issue — drives the "Runs" history section.
  // Path is `/task-runs` (server/cmd/server/router.go:353), NOT `/tasks` —
  // the latter doesn't exist on this scope.
  async listTasksByIssue(
    issueId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<AgentTask[]> {
    return this.fetchValidated(
      `/api/issues/${issueId}/task-runs`,
      AgentTaskListSchema,
      EMPTY_AGENT_TASK_LIST,
      { ...opts, endpoint: "GET /api/issues/:id/task-runs" },
    );
  }

  // GET /api/issues/:id/children — direct sub-issues of a parent. Returns the
  // inner `issues` array (handler wraps it in `{ issues: Issue[] }`, core
  // client.ts:995). The sub-issue section reads this to render the parent's
  // children list with title + status + stage grouping.
  async listChildIssues(
    issueId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<Issue[]> {
    const parsed = await this.fetchValidated(
      `/api/issues/${issueId}/children`,
      ChildIssuesResponseSchema,
      EMPTY_CHILD_ISSUES_RESPONSE,
      { ...opts, endpoint: "GET /api/issues/:id/children" },
    );
    return parsed.issues;
  }

  async createComment(
    issueId: string,
    content: string,
    opts?: { parentId?: string; type?: string; attachmentIds?: string[] },
  ): Promise<Comment> {
    // Body shape mirrors backend `CreateCommentRequest`
    // (server/internal/handler/comment.go:165). `parent_id` is sent only
    // when present so top-level comments don't carry an explicit null.
    // `type` defaults to "comment" matching web client.ts:686.
    return this.fetchValidatedWith(
      `/api/issues/${issueId}/comments`,
      CommentSchema,
      EMPTY_COMMENT,
      {
        method: "POST",
        body: JSON.stringify({
          content,
          type: opts?.type ?? "comment",
          ...(opts?.parentId ? { parent_id: opts.parentId } : {}),
          ...(opts?.attachmentIds ? { attachment_ids: opts.attachmentIds } : {}),
        }),
      },
      { endpoint: "createComment" },
    );
  }

  // PUT /api/comments/:id — content edit (+ optional attachment swap).
  async updateComment(
    commentId: string,
    content: string,
    attachmentIds?: string[],
  ): Promise<Comment> {
    return this.fetchValidatedWith(
      `/api/comments/${commentId}`,
      CommentSchema,
      EMPTY_COMMENT,
      {
        method: "PUT",
        body: JSON.stringify({
          content,
          ...(attachmentIds ? { attachment_ids: attachmentIds } : {}),
        }),
      },
      { endpoint: "updateComment" },
    );
  }

  // DELETE /api/comments/:id — 204 No Content on success; this.fetch
  // already short-circuits 204 → undefined.
  async deleteComment(commentId: string): Promise<void> {
    await this.fetch<void>(`/api/comments/${commentId}`, { method: "DELETE" });
  }

  // POST /api/comments/:id/resolve — marks the thread root resolved; only
  // meaningful for root comments. Backend mirrors web semantics.
  async resolveComment(commentId: string): Promise<Comment> {
    return this.fetchValidatedWith(
      `/api/comments/${commentId}/resolve`,
      CommentSchema,
      EMPTY_COMMENT,
      { method: "POST" },
      { endpoint: "resolveComment" },
    );
  }

  // DELETE /api/comments/:id/resolve — un-resolves the thread.
  async unresolveComment(commentId: string): Promise<Comment> {
    return this.fetchValidatedWith(
      `/api/comments/${commentId}/resolve`,
      CommentSchema,
      EMPTY_COMMENT,
      { method: "DELETE" },
      { endpoint: "unresolveComment" },
    );
  }

  // --- Reactions ---
  // Comment reactions: POST/DELETE /api/comments/{id}/reactions
  // Issue reactions:   POST/DELETE /api/issues/{id}/reactions
  // Mirror surface from packages/core/api/client.ts:541-573.
  async addReaction(commentId: string, emoji: string): Promise<Reaction> {
    return this.fetch<Reaction>(`/api/comments/${commentId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
    });
  }

  async removeReaction(commentId: string, emoji: string): Promise<void> {
    await this.fetch<void>(`/api/comments/${commentId}/reactions`, {
      method: "DELETE",
      body: JSON.stringify({ emoji }),
    });
  }

  async addIssueReaction(
    issueId: string,
    emoji: string,
  ): Promise<IssueReaction> {
    return this.fetch<IssueReaction>(`/api/issues/${issueId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
    });
  }

  async removeIssueReaction(issueId: string, emoji: string): Promise<void> {
    await this.fetch<void>(`/api/issues/${issueId}/reactions`, {
      method: "DELETE",
      body: JSON.stringify({ emoji }),
    });
  }

  // --- Issue update ---
  // Write endpoint — the mutation surface handles errors via rollback, so
  // we let bad responses surface naturally (no parseWithFallback).
  // Method is PUT to match backend router (server/cmd/server/router.go:327)
  // and web client (packages/core/api/client.ts:465).
  async updateIssue(id: string, body: UpdateIssueRequest): Promise<Issue> {
    return this.fetch<Issue>(`/api/issues/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  // Backend returns 204 No Content on success
  // (server/internal/handler/issue.go DeleteIssue). this.fetch already
  // short-circuits 204 → undefined (api.ts:270), so no body parsing needed.
  async deleteIssue(id: string): Promise<void> {
    await this.fetch<void>(`/api/issues/${id}`, { method: "DELETE" });
  }

  // --- Labels ---
  async listLabels(opts?: {
    signal?: AbortSignal;
  }): Promise<ListLabelsResponse> {
    const raw = await this.fetch<unknown>("/api/labels", {
      signal: opts?.signal,
    });
    return parseWithFallback(
      raw,
      ListLabelsResponseSchema,
      EMPTY_LIST_LABELS_RESPONSE,
      { endpoint: "GET /api/labels" },
    );
  }

  // Create a new label and return it. Response is consumed by the
  // create-and-attach flow in label picker, so raw `this.fetch<Label>` is
  // used — same convention as createProject (cache rollback on failure is
  // preferable to a parseWithFallback fallback that would mask server errors).
  async createLabel(body: CreateLabelRequest): Promise<Label> {
    return this.fetch<Label>("/api/labels", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // Get a single label by id. Drift defense via LabelSchema + EMPTY_LABEL
  // fallback — mirrors getSquad for this read-only endpoint.
  async getLabel(id: string): Promise<Label> {
    const raw = await this.fetch<unknown>(`/api/labels/${id}`);
    return parseWithFallback(raw, LabelSchema, EMPTY_LABEL, {
      endpoint: "GET /api/labels/{id}",
    });
  }

  // Update label fields (PUT). parseWithFallback to LabelSchema — the
  // authoritative response then patches the flattened Label[] list cache in
  // useUpdateLabel.onSuccess.
  async updateLabel(id: string, body: UpdateLabelRequest): Promise<Label> {
    const raw = await this.fetch<unknown>(`/api/labels/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return parseWithFallback(raw, LabelSchema, EMPTY_LABEL, {
      endpoint: "PUT /api/labels/{id}",
    });
  }

  // Backend returns 204 No Content on success; this.fetch already
  // short-circuits 204 → undefined, so no body parsing needed.
  async deleteLabel(id: string): Promise<void> {
    await this.fetch<void>(`/api/labels/${id}`, { method: "DELETE" });
  }

  // --- Custom issue properties ---
  // Workspace property-definition catalog (MUL-4463). Active definitions by
  // default; includeArchived=true surfaces archived ones for the management
  // page. A backend predating custom properties 404s here — treat it as an
  // empty catalog (empty property UI) rather than an error, same convention
  // as web's core client.
  async listProperties(opts?: {
    includeArchived?: boolean;
    signal?: AbortSignal;
  }): Promise<ListPropertiesResponse> {
    const suffix = opts?.includeArchived ? "?include_archived=true" : "";
    let raw: unknown;
    try {
      raw = await this.fetch<unknown>(`/api/properties${suffix}`, {
        signal: opts?.signal,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return EMPTY_LIST_PROPERTIES_RESPONSE;
      }
      throw error;
    }
    return parseWithFallback(raw, ListPropertiesResponseSchema, EMPTY_LIST_PROPERTIES_RESPONSE, {
      endpoint: "GET /api/properties",
    });
  }

  // Create a property definition. Raw fetch (same convention as createLabel):
  // the returned definition is consumed directly, and a parseWithFallback
  // fallback would mask server validation errors.
  async createProperty(body: CreatePropertyRequest): Promise<IssueProperty> {
    return this.fetch<IssueProperty>("/api/properties", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // Rename / re-option / archive a definition. PATCH with drift defense to
  // IssuePropertySchema — the authoritative response replaces the row in the
  // management-page list cache.
  async updateProperty(id: string, body: UpdatePropertyRequest): Promise<IssueProperty> {
    const raw = await this.fetch<unknown>(`/api/properties/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return parseWithFallback(raw, IssuePropertySchema, EMPTY_ISSUE_PROPERTY, {
      endpoint: "PATCH /api/properties/{id}",
    });
  }

  // Set one property value on an issue. The response is the full
  // post-mutation value bag, letting callers reconcile the whole set.
  async setIssueProperty(
    issueId: string,
    propertyId: string,
    value: IssuePropertyValue,
  ): Promise<IssuePropertiesResponse> {
    const raw = await this.fetch<unknown>(
      `/api/issues/${issueId}/properties/${propertyId}`,
      { method: "PUT", body: JSON.stringify({ value }) },
    );
    return parseWithFallback(raw, IssuePropertiesResponseSchema, EMPTY_ISSUE_PROPERTIES_RESPONSE, {
      endpoint: "PUT /api/issues/{id}/properties/{propertyId}",
    });
  }

  // Remove a property value from an issue. Returns the remaining value bag.
  async unsetIssueProperty(
    issueId: string,
    propertyId: string,
  ): Promise<IssuePropertiesResponse> {
    const raw = await this.fetch<unknown>(
      `/api/issues/${issueId}/properties/${propertyId}`,
      { method: "DELETE" },
    );
    return parseWithFallback(raw, IssuePropertiesResponseSchema, EMPTY_ISSUE_PROPERTIES_RESPONSE, {
      endpoint: "DELETE /api/issues/{id}/properties/{propertyId}",
    });
  }

  // --- Skills ---
  // List endpoint returns a bare `SkillSummary[]` (no `content`/`files`
  // bodies). Drift defense via SkillListSchema; the fallback empties the
  // list instead of crashing the page, same as listLabels.
  async listSkills(opts?: {
    signal?: AbortSignal;
  }): Promise<SkillSummary[]> {
    const raw = await this.fetch<unknown>("/api/skills", {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, SkillListSchema, EMPTY_SKILL_LIST, {
      endpoint: "GET /api/skills",
    });
  }

  // Full skill: `content` + `files[]` included. Drift defense mirrors
  // getLabel for this read-only endpoint.
  async getSkill(id: string): Promise<Skill> {
    const raw = await this.fetch<unknown>(`/api/skills/${id}`);
    return parseWithFallback(raw, SkillSchema, EMPTY_SKILL, {
      endpoint: "GET /api/skills/{id}",
    });
  }

  async createSkill(body: CreateSkillRequest): Promise<Skill> {
    return this.fetch<Skill>("/api/skills", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async updateSkill(id: string, body: UpdateSkillRequest): Promise<Skill> {
    const raw = await this.fetch<unknown>(`/api/skills/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return parseWithFallback(raw, SkillSchema, EMPTY_SKILL, {
      endpoint: "PUT /api/skills/{id}",
    });
  }

  // 204 No Content on success, same as deleteLabel.
  async deleteSkill(id: string): Promise<void> {
    await this.fetch<void>(`/api/skills/${id}`, { method: "DELETE" });
  }

  // --- Workspace MCP server library + agent assignments (GH #6062) ---
  // Semantics mirror packages/core/api/client.ts — identity + transport only
  // round-trip (config is write-only), and every agent-scoped write returns
  // the resulting assignment list so the client reconciles from the server.

  // The workspace's MCP server library. Member-visible: this is what an agent
  // owner picks from on the agent's own MCP tab.
  async listWorkspaceMcpServers(workspaceId: string): Promise<WorkspaceMcpServer[]> {
    const raw = await this.fetch<unknown>(`/api/workspaces/${workspaceId}/mcp-servers`);
    return parseWithFallback(raw, WorkspaceMcpServerListSchema, EMPTY_WORKSPACE_MCP_SERVER_LIST, {
      endpoint: "GET /api/workspaces/{id}/mcp-servers",
    });
  }

  // Adds a server to the library. It is assigned to NO agent — an agent gets
  // it only through addAgentMcpServer.
  async createWorkspaceMcpServer(
    workspaceId: string,
    name: string,
    config: Record<string, unknown>,
  ): Promise<WorkspaceMcpServer> {
    const raw = await this.fetch<unknown>(`/api/workspaces/${workspaceId}/mcp-servers`, {
      method: "POST",
      body: JSON.stringify({ name, config }),
    });
    return parseWithFallback(raw, WorkspaceMcpServerSchema, EMPTY_WORKSPACE_MCP_SERVER, {
      endpoint: "POST /api/workspaces/{id}/mcp-servers",
    });
  }

  // Renames a library entry, replaces its configuration, or both. Agents keep
  // their assignment across a rename because assignments key off the id.
  async updateWorkspaceMcpServer(
    workspaceId: string,
    serverId: string,
    update: { name?: string; config?: Record<string, unknown> },
  ): Promise<WorkspaceMcpServer> {
    const raw = await this.fetch<unknown>(
      `/api/workspaces/${workspaceId}/mcp-servers/${encodeURIComponent(serverId)}`,
      { method: "PUT", body: JSON.stringify(update) },
    );
    return parseWithFallback(raw, WorkspaceMcpServerSchema, EMPTY_WORKSPACE_MCP_SERVER, {
      endpoint: "PUT /api/workspaces/{id}/mcp-servers/{serverId}",
    });
  }

  // Removes a library entry and every assignment to it.
  async deleteWorkspaceMcpServer(workspaceId: string, serverId: string): Promise<void> {
    await this.fetch<unknown>(
      `/api/workspaces/${workspaceId}/mcp-servers/${encodeURIComponent(serverId)}`,
      { method: "DELETE" },
    );
  }

  // The workspace MCP servers assigned to this agent, with their toggles.
  async listAgentMcpServers(agentId: string): Promise<WorkspaceMcpServer[]> {
    const raw = await this.fetch<unknown>(`/api/agents/${agentId}/mcp-servers`);
    return parseWithFallback(raw, WorkspaceMcpServerListSchema, EMPTY_WORKSPACE_MCP_SERVER_LIST, {
      endpoint: "GET /api/agents/{id}/mcp-servers",
    });
  }

  // Gives one workspace server to this agent. Every write returns the
  // resulting assignment list, so the client never has to guess the state.
  async addAgentMcpServer(agentId: string, serverId: string): Promise<WorkspaceMcpServer[]> {
    const raw = await this.fetch<unknown>(`/api/agents/${agentId}/mcp-servers`, {
      method: "POST",
      body: JSON.stringify({ server_id: serverId }),
    });
    return parseWithFallback(raw, WorkspaceMcpServerListSchema, EMPTY_WORKSPACE_MCP_SERVER_LIST, {
      endpoint: "POST /api/agents/{id}/mcp-servers",
    });
  }

  async setAgentMcpServerEnabled(
    agentId: string,
    serverId: string,
    enabled: boolean,
  ): Promise<WorkspaceMcpServer[]> {
    const raw = await this.fetch<unknown>(
      `/api/agents/${agentId}/mcp-servers/${encodeURIComponent(serverId)}/enabled`,
      { method: "PUT", body: JSON.stringify({ enabled }) },
    );
    return parseWithFallback(raw, WorkspaceMcpServerListSchema, EMPTY_WORKSPACE_MCP_SERVER_LIST, {
      endpoint: "PUT /api/agents/{id}/mcp-servers/{serverId}/enabled",
    });
  }

  async removeAgentMcpServer(agentId: string, serverId: string): Promise<WorkspaceMcpServer[]> {
    const raw = await this.fetch<unknown>(
      `/api/agents/${agentId}/mcp-servers/${encodeURIComponent(serverId)}`,
      { method: "DELETE" },
    );
    return parseWithFallback(raw, WorkspaceMcpServerListSchema, EMPTY_WORKSPACE_MCP_SERVER_LIST, {
      endpoint: "DELETE /api/agents/{id}/mcp-servers/{serverId}",
    });
  }

  async attachLabel(
    issueId: string,
    labelId: string,
  ): Promise<IssueLabelsResponse> {
    return this.fetch<IssueLabelsResponse>(
      `/api/issues/${issueId}/labels`,
      {
        method: "POST",
        body: JSON.stringify({ label_id: labelId }),
      },
    );
  }

  async detachLabel(
    issueId: string,
    labelId: string,
  ): Promise<IssueLabelsResponse> {
    return this.fetch<IssueLabelsResponse>(
      `/api/issues/${issueId}/labels/${labelId}`,
      { method: "DELETE" },
    );
  }

  // --- Projects ---
  async listProjects(opts?: {
    signal?: AbortSignal;
  }): Promise<ListProjectsResponse> {
    const raw = await this.fetch<unknown>("/api/projects", {
      signal: opts?.signal,
    });
    return parseWithFallback(
      raw,
      ListProjectsResponseSchema,
      EMPTY_LIST_PROJECTS_RESPONSE,
      { endpoint: "GET /api/projects" },
    );
  }

  /** Workspace-wide project search. See `searchIssues` for the signal
   *  contract. */
  async searchProjects(
    params: { q: string; limit?: number; include_closed?: boolean; offset?: number },
    opts?: { signal?: AbortSignal },
  ): Promise<SearchProjectsResponse> {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue;
      search.set(k, String(v));
    }
    const raw = await this.fetch<unknown>(
      `/api/projects/search?${search.toString()}`,
      { signal: opts?.signal },
    );
    return parseWithFallback(
      raw,
      SearchProjectsResponseSchema,
      EMPTY_SEARCH_PROJECTS_RESPONSE,
      { endpoint: "GET /api/projects/search" },
    );
  }

  async getProject(
    id: string,
    opts?: { signal?: AbortSignal },
  ): Promise<Project> {
    const raw = await this.fetch<unknown>(`/api/projects/${id}`, {
      signal: opts?.signal,
    });
    // Drift-safe parse — UI checks `data.id === ""` to render the
    // "project not found / shape drifted" error state instead of a
    // half-populated detail page.
    return parseWithFallback(raw, ProjectSchema, EMPTY_PROJECT, {
      endpoint: "GET /api/projects/:id",
    });
  }

  // Write endpoints — no parseWithFallback (mirrors updateIssue:430). A
  // malformed write response surfaces as an error so the optimistic
  // patch rolls back; pretending the write succeeded with empty data
  // would silently desync caches.
  async createProject(body: CreateProjectRequest): Promise<Project> {
    return this.fetch<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async updateProject(
    id: string,
    body: UpdateProjectRequest,
  ): Promise<Project> {
    return this.fetch<Project>(`/api/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async deleteProject(id: string): Promise<void> {
    await this.fetch<void>(`/api/projects/${id}`, { method: "DELETE" });
  }

  // --- Project resources ---
  async listProjectResources(
    projectId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<ListProjectResourcesResponse> {
    const raw = await this.fetch<unknown>(
      `/api/projects/${projectId}/resources`,
      { signal: opts?.signal },
    );
    return parseWithFallback(
      raw,
      ListProjectResourcesResponseSchema,
      EMPTY_LIST_PROJECT_RESOURCES_RESPONSE,
      { endpoint: "GET /api/projects/:id/resources" },
    );
  }

  async createProjectResource(
    projectId: string,
    body: CreateProjectResourceRequest,
  ): Promise<ProjectResource> {
    return this.fetch<ProjectResource>(
      `/api/projects/${projectId}/resources`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
  }

  async deleteProjectResource(
    projectId: string,
    resourceId: string,
  ): Promise<void> {
    await this.fetch<void>(
      `/api/projects/${projectId}/resources/${resourceId}`,
      { method: "DELETE" },
    );
  }

  // --- Chat ---
  // Mirrors the surface area of packages/core/api/client.ts chat methods.
  // v1 omits getChatSession + updateChatSession (rename) — see the v1 cut
  // list in /Users/qingnaiyuan/.claude/plans/plan-velvety-puddle.md.

  async listChatSessions(
    opts?: { signal?: AbortSignal },
  ): Promise<ChatSession[]> {
    const raw = await this.fetch<unknown>("/api/chat/sessions", {
      signal: opts?.signal,
    });
    return parseWithFallback(
      raw,
      ChatSessionListSchema,
      EMPTY_CHAT_SESSION_LIST,
      { endpoint: "GET /api/chat/sessions" },
    );
  }

  async createChatSession(
    data: { agent_id: string; title?: string },
  ): Promise<ChatSession> {
    // Strict parse — a malformed create response derails the optimistic
    // burst (we need the new session id to seed caches). Fallback would
    // be worse than the throw.
    const raw = await this.fetch<unknown>("/api/chat/sessions", {
      method: "POST",
      body: JSON.stringify(data),
    });
    const parsed = ChatSessionSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("[api] ← shape mismatch POST /api/chat/sessions", {
        issues: parsed.error.issues,
      });
      throw new ApiError("Create chat session response invalid", 0, raw);
    }
    return parsed.data;
  }

  async deleteChatSession(id: string): Promise<void> {
    await this.fetch<void>(`/api/chat/sessions/${id}`, { method: "DELETE" });
  }

  /** PATCH /api/chat/sessions/:id/archive — retires a builder conversation
   *  once its agent exists (archived = read-only + dropped from the drafts
   *  list; the conversation stays as the record of how the agent was
   *  designed). Mirrors packages/core/api/client.ts:2734. */
  async setChatSessionArchived(
    id: string,
    archived: boolean,
  ): Promise<ChatSession> {
    return this.fetch<ChatSession>(`/api/chat/sessions/${id}/archive`, {
      method: "PATCH",
      body: JSON.stringify({ archived }),
    });
  }

  async listChatMessages(
    sessionId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<ChatMessage[]> {
    const raw = await this.fetch<unknown>(
      `/api/chat/sessions/${sessionId}/messages`,
      { signal: opts?.signal },
    );
    return parseWithFallback(
      raw,
      ChatMessageListSchema,
      EMPTY_CHAT_MESSAGE_LIST,
      { endpoint: "GET /api/chat/sessions/:id/messages" },
    );
  }

  async sendChatMessage(
    sessionId: string,
    content: string,
    opts?: { attachmentIds?: string[] },
  ): Promise<SendChatMessageResponse> {
    // Strict parse — we need task_id + created_at to anchor the optimistic
    // StatusPill. Fallback would silently break the elapsed-time timer.
    //
    // `attachment_ids` mirrors the comment / issue create payloads —
    // server-side `chat.go` back-fills `chat_message_id` on the listed
    // attachments after the message row is inserted (see
    // server/internal/handler/chat.go:410-456).
    const body: { content: string; attachment_ids?: string[] } = { content };
    if (opts?.attachmentIds && opts.attachmentIds.length > 0) {
      body.attachment_ids = opts.attachmentIds;
    }
    const raw = await this.fetch<unknown>(
      `/api/chat/sessions/${sessionId}/messages`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    const parsed = SendChatMessageResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("[api] ← shape mismatch POST /api/chat/sessions/:id/messages", {
        issues: parsed.error.issues,
      });
      throw new ApiError("Send message response invalid", 0, raw);
    }
    return parsed.data;
  }

  async getPendingChatTask(
    sessionId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<ChatPendingTask> {
    const raw = await this.fetch<unknown>(
      `/api/chat/sessions/${sessionId}/pending-task`,
      { signal: opts?.signal },
    );
    return parseWithFallback(
      raw,
      ChatPendingTaskSchema,
      EMPTY_CHAT_PENDING_TASK,
      { endpoint: "GET /api/chat/sessions/:id/pending-task" },
    );
  }

  async markChatSessionRead(sessionId: string): Promise<void> {
    await this.fetch<void>(
      `/api/chat/sessions/${sessionId}/read`,
      { method: "POST" },
    );
  }

  async cancelTaskById(taskId: string): Promise<void> {
    await this.fetch<void>(`/api/tasks/${taskId}/cancel`, { method: "POST" });
  }

  /** Live execution timeline for a task — used by the chat screen to
   *  render the "thinking → tool_use → tool_result → final text" trace
   *  beneath an in-flight assistant bubble. `task:message` WS events
   *  append to the same cache key in real time (see
   *  use-chat-session-realtime.ts). */
  async listTaskMessages(
    taskId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<TaskMessagePayload[]> {
    return this.fetchValidated(
      `/api/tasks/${taskId}/messages`,
      TaskMessageListSchema,
      EMPTY_TASK_MESSAGE_LIST,
      { ...opts, endpoint: "GET /api/tasks/:id/messages" },
    );
  }

  // --- Autopilots ---
  //
  // Mirror packages/core/api/client.ts:3499-3560. List/detail/runs are
  // workspace-scoped via the X-Workspace-Slug header (fetch adds it); runs
  // and the list parse through core schemas (drift defense), detail through
  // the mobile-local AutopilotDetailSchema.

  async listAutopilots(
    params?: { status?: string },
    opts?: { signal?: AbortSignal },
  ): Promise<ListAutopilotsResponse> {
    const search = new URLSearchParams();
    if (params?.status) search.set("status", params.status);
    const qs = search.toString();
    return this.fetchValidated(
      `/api/autopilots${qs ? `?${qs}` : ""}`,
      ListAutopilotsResponseSchema,
      EMPTY_LIST_AUTOPILOTS_RESPONSE as ListAutopilotsResponse,
      { ...opts, endpoint: "GET /api/autopilots" },
    );
  }

  async getAutopilot(
    id: string,
    opts?: { signal?: AbortSignal },
  ): Promise<GetAutopilotResponse> {
    const parsed = await this.fetchValidated(
      `/api/autopilots/${id}`,
      AutopilotDetailSchema,
      // Fallback shape matches what the detail screen reads before data
      // lands; triggers default to [] so "no triggers" renders, not a crash.
      EMPTY_AUTOPILOT_DETAIL,
      { ...opts, endpoint: "GET /api/autopilots/:id" },
    );
    return parsed as unknown as GetAutopilotResponse;
  }

  // PATCH response is not consumed by the UI (optimistic patch + invalidate
  // on settle), so a raw fetch follows the write-endpoint rule — a malformed
  // response surfaces naturally and rolls the optimistic patch back.
  async updateAutopilot(
    id: string,
    data: UpdateAutopilotRequest,
  ): Promise<Autopilot> {
    return this.fetch<Autopilot>(`/api/autopilots/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async listAutopilotRuns(
    id: string,
    params?: { limit?: number; offset?: number },
    opts?: { signal?: AbortSignal },
  ): Promise<ListAutopilotRunsResponse> {
    const search = new URLSearchParams();
    if (params?.limit) search.set("limit", String(params.limit));
    if (params?.offset) search.set("offset", String(params.offset));
    const qs = search.toString();
    return this.fetchValidated(
      `/api/autopilots/${id}/runs${qs ? `?${qs}` : ""}`,
      ListAutopilotRunsResponseSchema,
      EMPTY_LIST_AUTOPILOT_RUNS_RESPONSE,
      { ...opts, endpoint: "GET /api/autopilots/:id/runs" },
    );
  }

  // Manual "run now" returns 200 even when admission blocks the run (status
  // skipped/failed) — the UI branches on status/reason_code to avoid a
  // false-success toast (MUL-4525), so the response must be schema-parsed.
  async triggerAutopilot(id: string): Promise<AutopilotRun> {
    return this.fetchValidatedWith(
      `/api/autopilots/${id}/trigger`,
      AutopilotRunSchema,
      FALLBACK_AUTOPILOT_RUN,
      { method: "POST" },
      { endpoint: "POST /api/autopilots/:id/trigger" },
    );
  }

  // Create/delete/trigger/rotate endpoints — mirror
  // packages/core/api/client.ts:3528-3631. Write endpoints follow the
  // write-endpoint rule (raw fetch — a malformed response surfaces
  // naturally). createAutopilot's response id drives the follow-up trigger
  // create, so it's captured raw like core.
  async createAutopilot(
    data: CreateAutopilotRequest,
  ): Promise<Autopilot> {
    return this.fetch<Autopilot>("/api/autopilots", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async deleteAutopilot(id: string): Promise<void> {
    await this.fetch<void>(`/api/autopilots/${id}`, { method: "DELETE" });
  }

  // Trigger create/update responses are not consumed by the UI (the detail
  // query refetch on settle is authoritative) — raw fetch per the
  // write-endpoint rule.
  async createAutopilotTrigger(
    autopilotId: string,
    data: CreateAutopilotTriggerRequest,
  ): Promise<AutopilotTrigger> {
    return this.fetch<AutopilotTrigger>(
      `/api/autopilots/${autopilotId}/triggers`,
      { method: "POST", body: JSON.stringify(data) },
    );
  }

  async updateAutopilotTrigger(
    autopilotId: string,
    triggerId: string,
    data: UpdateAutopilotTriggerRequest,
  ): Promise<AutopilotTrigger> {
    return this.fetch<AutopilotTrigger>(
      `/api/autopilots/${autopilotId}/triggers/${triggerId}`,
      { method: "PATCH", body: JSON.stringify(data) },
    );
  }

  async deleteAutopilotTrigger(
    autopilotId: string,
    triggerId: string,
  ): Promise<void> {
    await this.fetch<void>(
      `/api/autopilots/${autopilotId}/triggers/${triggerId}`,
      { method: "DELETE" },
    );
  }

  // Rotate returns the updated trigger carrying the NEW webhook token/url,
  // which the UI surfaces to the user right after rotation — parse it
  // through the mobile-local trigger schema so a drifted body degrades to
  // a generic row (id === "" detectable) instead of a crash.
  async rotateAutopilotWebhookToken(
    autopilotId: string,
    triggerId: string,
  ): Promise<AutopilotTrigger> {
    return this.fetchValidatedWith(
      `/api/autopilots/${autopilotId}/triggers/${triggerId}/rotate-webhook-token`,
      AutopilotTriggerSchema,
      EMPTY_AUTOPILOT_TRIGGER,
      { method: "POST" },
      {
        endpoint:
          "POST /api/autopilots/:id/triggers/:triggerId/rotate-webhook-token",
      },
    );
  }

  // Schedule-form pre-validation. The server answers with 400 for a
  // rejected cron expression / timezone — callers surface the classified
  // rejection (invalid_cron vs invalid_timezone) before the trigger POST.
  async cronPreview(
    params: { expr: string; tz: string },
  ): Promise<CronPreviewResponse> {
    const search = new URLSearchParams();
    search.set("expr", params.expr);
    search.set("tz", params.tz);
    return this.fetchValidated(
      `/api/autopilots/cron-preview?${search}`,
      CronPreviewResponseSchema,
      EMPTY_CRON_PREVIEW_RESPONSE,
      { endpoint: "GET /api/autopilots/cron-preview" },
    );
  }

  // --- Pins ---
  //
  // Pin metadata only — title / status / icon for each row come from
  // `issueDetailOptions` / `projectDetailOptions` on the consumer side.
  // Endpoints mirror packages/core/api/client.ts:1551-1572.

  async listPins(opts?: { signal?: AbortSignal }): Promise<PinnedItem[]> {
    return this.fetchValidated(
      "/api/pins",
      PinListSchema,
      EMPTY_PIN_LIST,
      { ...opts, endpoint: "listPins" },
    );
  }

  async createPin(data: {
    item_type: PinnedItemType;
    item_id: string;
  }): Promise<PinnedItem> {
    return this.fetchValidatedWith(
      "/api/pins",
      PinnedItemSchema,
      // Mirror EMPTY_PIN_LIST element shape — onSuccess uses the returned
      // pin's id/position so a stub with empty id is detectable downstream.
      {
        id: "",
        workspace_id: "",
        user_id: "",
        item_type: data.item_type,
        item_id: data.item_id,
        position: 0,
        created_at: "",
      },
      { method: "POST", body: JSON.stringify(data) },
      { endpoint: "createPin" },
    );
  }

  async deletePin(itemType: PinnedItemType, itemId: string): Promise<void> {
    await this.fetch<void>(`/api/pins/${itemType}/${itemId}`, {
      method: "DELETE",
    });
  }

  async reorderPins(data: ReorderPinsRequest): Promise<void> {
    await this.fetch<void>("/api/pins/reorder", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  // --- File Upload ---

  /**
   * Multipart-stream a file to `/api/upload-file`. Mirrors the web
   * implementation in `packages/core/api/client.ts:uploadFile` but with the
   * RN-shaped `FileAsset` instead of a browser `File`. The fetch FormData
   * polyfill recognises `{ uri, name, type }` and reads the file off disk.
   *
   * `opts.issueId` / `opts.commentId` link the attachment record. Pass
   * `issueId` when uploading from a comment composer / reply input; leave
   * both empty when uploading from a not-yet-created issue (the attachment
   * is hooked to the issue once it's created — same flow as web).
   *
   * Does NOT use `this.fetch` because:
   *   - FormData must not have a `Content-Type` header preset (the browser /
   *     RN fetch needs to set the multipart boundary itself).
   *   - `this.fetch` hard-codes `application/json`.
   *
   * So we re-implement the auth + slug + logging shell inline.
   */
  async uploadFile(
    asset: FileAsset,
    opts?: { issueId?: string; commentId?: string },
  ): Promise<Attachment> {
    const rid = createRequestId();
    const start = Date.now();
    const path = "/api/upload-file";

    const headers: Record<string, string> = {
      // No Content-Type — let fetch set the multipart boundary.
      "X-Client-Platform": "mobile",
      "X-Client-OS": "ios",
      "X-Client-Version": "0.1.0",
      "X-Request-ID": rid,
    };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const slug = getCurrentSlug();
    if (slug) headers["X-Workspace-Slug"] = slug;

    const formData = new FormData();
    // RN's FormData accepts `{ uri, name, type }` as the file value.
    // `as never` quiets TS (the global FormData type expects `Blob | string`).
    formData.append(
      "file",
      { uri: asset.uri, name: asset.name, type: asset.type } as never,
    );
    if (opts?.issueId) formData.append("issue_id", opts.issueId);
    if (opts?.commentId) formData.append("comment_id", opts.commentId);

    console.log(`[api] → POST ${path}`, { rid, filename: asset.name });

    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: "POST",
      headers,
      body: formData,
    });
    const duration = Date.now() - start;

    if (!res.ok) {
      if (res.status === 401) this.options.onUnauthorized?.();
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      const message =
        (body && typeof body === "object" && "message" in body
          ? String((body as { message: unknown }).message)
          : null) ?? `Upload failed: ${res.status}`;
      console.error(`[api] ← ${res.status} ${path}`, {
        rid,
        duration: `${duration}ms`,
        error: message,
      });
      throw new ApiError(message, res.status, body);
    }

    console.log(`[api] ← ${res.status} ${path}`, {
      rid,
      duration: `${duration}ms`,
    });

    // Strict validation: parseWithFallback's silent-fallback pattern doesn't
    // fit here — an attachment without a `url` would be inserted into the
    // user's text as `![](undefined)`. Throw on shape mismatch so the
    // caller's Alert path fires instead of letting a broken link land in
    // the editor.
    const json: unknown = await res.json();
    const parsed = AttachmentSchema.safeParse(json);
    if (!parsed.success) {
      console.error(`[api] ← shape mismatch ${path}`, {
        rid,
        error: parsed.error.message,
      });
      throw new ApiError("Upload response invalid", res.status, json);
    }
    return parsed.data;
  }

  // --- File Download ---

  /**
   * Download an attachment to the app cache using the *current* session auth.
   *
   * Replaces the historic `Linking.openURL` handoff (MYS-270): opening the
   * signed `download_url` in the external browser sent no `Authorization`
   * header, so the server rejected it with `missing authorization`. This does
   * the GET in-app with `Bearer` + workspace slug attached and writes the bytes
   * to a cache file via expo-file-system, so the token never reaches a browser
   * tab or a log line.
   *
   * `rawUrl` may be server-relative (`/api/attachments/<id>/download`) or an
   * already-absolute presigned/CloudFront URL; relative paths are resolved
   * against the current runtime API base. The saved filename is derived from
   * `filename` and sanitized to a single safe cache basename.
   *
   * Throws `ApiError` on any failure (bad URL, non-2xx status — including the
   * 401 `missing authorization` the browser path used to hit — or a native
   * download error).
   */
  // --- Personal access tokens ---
  //
  // Account-level (not workspace-scoped), mirrors
  // packages/core/api/client.ts:2606-2619. The list is read through the
  // validated rail so a drifted row degrades to blank metadata instead of a
  // crash; create parses the response (it carries the full token, shown once
  // and never cached) and revoke is a raw DELETE.

  async listPersonalAccessTokens(
    opts?: { signal?: AbortSignal },
  ): Promise<PersonalAccessToken[]> {
    return this.fetchValidated(
      "/api/tokens",
      PersonalAccessTokenListSchema,
      [],
      { ...opts, endpoint: "GET /api/tokens" },
    );
  }

  async createPersonalAccessToken(
    data: CreatePersonalAccessTokenRequest,
  ): Promise<CreatePersonalAccessTokenResponse> {
    return this.fetchValidatedWith(
      "/api/tokens",
      CreatePersonalAccessTokenResponseSchema,
      { id: "", name: "", token_prefix: "", expires_at: null, last_used_at: null, created_at: "", token: "" },
      { method: "POST", body: JSON.stringify(data) },
      { endpoint: "POST /api/tokens" },
    );
  }

  async revokePersonalAccessToken(id: string): Promise<void> {
    await this.fetch<void>(
      `/api/tokens/${id}`,
      { method: "DELETE" },
    );
  }

  async downloadFile(rawUrl: string, filename: string): Promise<LocalDownload> {
    const absUrl = resolveAttachmentUrl(rawUrl);
    if (!absUrl) {
      throw new ApiError("Attachment download URL is unavailable", 0);
    }

    const headers: Record<string, string> = {};
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const slug = getCurrentSlug();
    if (slug) headers["X-Workspace-Slug"] = slug;

    const safeName = sanitizeBasename(filename) || "download";
    const start = Date.now();
    console.log(`[api] → GET ${absUrl}`, { rid: createRequestId() });

    try {
      const destination = new File(Paths.cache, safeName);
      const file = await File.downloadFileAsync(absUrl, destination, {
        headers,
        idempotent: true,
      });
      console.log(`[api] ← saved ${file.name}`, {
        duration: `${Date.now() - start}ms`,
      });
      return { uri: file.uri, name: safeName };
    } catch (err) {
      console.error(`[api] ← DOWNLOAD FAILED ${absUrl}`, {
        duration: `${Date.now() - start}ms`,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new ApiError(
        err instanceof Error ? err.message : "Attachment download failed",
        0,
      );
    }
  }

  /**
   * Progress-tracked, cancellable authenticated download — the download
   * manager's engine. `downloadFile` above keeps its fire-and-forget
   * semantics for callers that only need the bytes; this variant wraps
   * `expo-file-system/legacy`'s `createDownloadResumable` so the caller can
   * render progress and abort mid-flight.
   *
   * Returns `null` when `rawUrl` can't be resolved to an absolute URL (same
   * gate as `downloadFile`). `onProgress` fires with the byte counters the
   * native stack reports (`-1` expected when the server sends no
   * Content-Length). The returned `cancel()` aborts the native task; the
   * `done` promise then rejects with `DownloadCancelledError` — never an
   * `ApiError`, so history records the cancel as its own state.
   */
  createDownloadTask(
    rawUrl: string,
    filename: string,
    onProgress?: (data: {
      totalBytesWritten: number;
      totalBytesExpectedToWrite: number;
    }) => void,
  ): { done: Promise<LocalDownload>; cancel: () => void } | null {
    const absUrl = resolveAttachmentUrl(rawUrl);
    if (!absUrl) return null;

    const headers: Record<string, string> = {};
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const slug = getCurrentSlug();
    if (slug) headers["X-Workspace-Slug"] = slug;

    const safeName = sanitizeBasename(filename) || "download";
    const destination = new File(Paths.cache, safeName).uri;
    const start = Date.now();
    console.log(`[api] → GET ${absUrl}`, { rid: createRequestId() });

    const resumable = createDownloadResumable(
      absUrl,
      destination,
      { headers },
      (data) => onProgress?.(data),
    );
    let cancelled = false;

    const done = resumable
      .downloadAsync()
      .then((result) => {
        // `undefined` is the native contract for an aborted task.
        if (cancelled || !result) throw new DownloadCancelledError();
        console.log(`[api] ← saved ${result.uri}`, {
          duration: `${Date.now() - start}ms`,
        });
        return { uri: result.uri, name: safeName };
      })
      .catch((err: unknown) => {
        if (err instanceof DownloadCancelledError) throw err;
        console.error(`[api] ← DOWNLOAD FAILED ${absUrl}`, {
          duration: `${Date.now() - start}ms`,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new ApiError(
          err instanceof Error ? err.message : "Attachment download failed",
          0,
        );
      });

    return {
      done,
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        void resumable.cancelAsync().catch(() => {
          // The task may already have settled; nothing left to abort.
        });
      },
    };
  }
}

export { MAX_FILE_SIZE };

export const api = new ApiClient();
