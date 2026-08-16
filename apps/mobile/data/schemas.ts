/**
 * Mobile-local zod schemas + fallbacks for endpoints whose responses aren't
 * yet schematised in @multica/core/api/schemas. Lenient by design — see the
 * leniency rationale at the top of the core file (string enums tolerated,
 * loose() so unknown server fields pass through, defaults so a missing
 * array doesn't take the page down).
 *
 * If web/desktop later need these same schemas, promote them to core; until
 * then they live here so mobile satisfies its "Parse, don't cast" rule
 * (root CLAUDE.md "API Response Compatibility") for these endpoints.
 */
import { z } from "zod";
import type {
  Agent,
  AgentEnvResponse,
  AgentInvocationTarget,
  AgentTask,
  Attachment,
  AutopilotRun,
  AutopilotTrigger,
  ChatMessage,
  ChatPendingTask,
  ChatSession,
  Comment,
  CreatePersonalAccessTokenResponse,
  CronPreviewResponse,
  DashboardAgentRunTime,
  DashboardFailureByAgent,
  DashboardFailureDaily,
  DashboardRunTimeDaily,
  DashboardUsageByAgent,
  DashboardUsageDaily,
  InboxItem,
  Invitation,
  IssueLabelsResponse,
  IssueSubscriber,
  Label,
  ListLabelsResponse,
  ListProjectResourcesResponse,
  ListProjectsResponse,
  MemberWithUser,
  PinnedItem,
  PersonalAccessToken,
  Project,
  ProjectResource,
  RuntimeDevice,
  SearchIssuesResponse,
  SearchProjectsResponse,
  SendChatMessageResponse,
  Skill,
  SkillSummary,
  Squad,
  SquadMember,
  SquadMemberPreview,
  TaskMessagePayload,
  User,
  Workspace,
  WorkspaceMcpServer,
} from "@multica/core/types";
import {
  AutopilotRunSchema,
  IssueSchema,
  SkillSchema,
  EMPTY_SKILL,
} from "@multica/core/api/schemas";

/** Upload response. Only fields mobile actually consumes — `url` to put
 *  into the markdown link, `filename` for the `[📎 name](url)` form, `id`
 *  for future linking. `.loose()` so the server can add fields without
 *  breaking mobile. Web's AttachmentSchema (packages/core/api/schemas.ts:41)
 *  is even looser (only `id`); mobile validates more because the upload
 *  flow inserts `url` directly into editable text and an empty `url` would
 *  produce a broken link the user only notices after submit. */
export const AttachmentSchema: z.ZodType<Attachment> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  issue_id: z.string().nullable().default(null),
  comment_id: z.string().nullable().default(null),
  chat_session_id: z.string().nullable().default(null),
  chat_message_id: z.string().nullable().default(null),
  uploader_type: z.string().default(""),
  uploader_id: z.string().default(""),
  filename: z.string(),
  url: z.string(),
  download_url: z.string().default(""),
  markdown_url: z.string().default(""),
  content_type: z.string().default(""),
  size_bytes: z.number().default(0),
  created_at: z.string().default(""),
}).loose();

/** GET /api/issues/:id/attachments — array of attachments for the issue.
 *  Empty array fallback so a 5xx or shape mismatch doesn't crash markdown
 *  rendering — image URIs simply fail to resolve and fall back to fetch. */
export const AttachmentListSchema = z.array(AttachmentSchema).default([]);
export const EMPTY_ATTACHMENT_LIST: Attachment[] = [];

/** Comment write endpoints all return a full Comment. Used by createComment /
 *  updateComment / resolveComment / unresolveComment via fetchValidatedWith.
 *  Empty fallback yields `id: ""` so downstream code (the mutations'
 *  onSuccess writers) can detect drift and fall back to invalidate. */
export const CommentSchema = z.object({
  id: z.string(),
  issue_id: z.string().default(""),
  author_type: z.string().default("member"),
  author_id: z.string().default(""),
  content: z.string().default(""),
  type: z.string().default("comment"),
  parent_id: z.string().nullable().default(null),
  reactions: z.array(z.unknown()).default([]),
  attachments: z.array(z.unknown()).default([]),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
  resolved_at: z.string().nullable().default(null),
  resolved_by_type: z.string().nullable().default(null),
  resolved_by_id: z.string().nullable().default(null),
  source_task_id: z.string().nullable().optional(),
}).loose() as unknown as z.ZodType<Comment>;

export const EMPTY_COMMENT: Comment = {
  id: "",
  issue_id: "",
  author_type: "member",
  author_id: "",
  content: "",
  type: "comment",
  parent_id: null,
  reactions: [],
  attachments: [],
  created_at: "",
  updated_at: "",
  resolved_at: null,
  resolved_by_type: null,
  resolved_by_id: null,
};

/** GET/PUT /api/notification-preferences. Preferences are partial — absent
 *  keys mean "default (= all)", an explicit "muted" turns the group off.
 *  Loose() so future group additions on the backend don't break parsing.
 *  Value type is z.string() (not z.enum) so a future server-side value like
 *  "snoozed" downgrades gracefully (read sites treat unknown as enabled)
 *  instead of failing schema parse and dropping the entire preferences map.
 *  Per CLAUDE.md "Enum drift downgrades, not crashes". */
export const NotificationPreferenceResponseSchema = z.object({
  workspace_id: z.string().default(""),
  preferences: z.record(z.string(), z.string()).default({}),
}).loose();
export const EMPTY_NOTIFICATION_PREFERENCES = {
  workspace_id: "",
  preferences: {},
} as const;

export const LabelSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  resource_type: z.string().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  color: z.string(),
  usage_count: z.number().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).loose();

export const EMPTY_LABEL: Label = {
  id: "",
  workspace_id: "",
  name: "",
  color: "",
  created_at: "",
  updated_at: "",
};

export const ListLabelsResponseSchema = z.object({
  labels: z.array(LabelSchema).default([]),
  total: z.number().default(0),
}).loose();

export const EMPTY_LIST_LABELS_RESPONSE: ListLabelsResponse = {
  labels: [],
  total: 0,
};

export const IssueLabelsResponseSchema = z.object({
  labels: z.array(LabelSchema).default([]),
}).loose();

export const EMPTY_ISSUE_LABELS_RESPONSE: IssueLabelsResponse = {
  labels: [],
};

export const ProjectSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  status: z.string(),
  priority: z.string(),
  lead_type: z.string().nullable(),
  lead_id: z.string().nullable(),
  // .default(null) so a project from an older backend that omits these keys
  // parses to null instead of degrading the batch to the empty fallback.
  start_date: z.string().nullable().default(null),
  due_date: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
  issue_count: z.number().default(0),
  done_count: z.number().default(0),
  resource_count: z.number().default(0),
}).loose();

export const ListProjectsResponseSchema = z.object({
  projects: z.array(ProjectSchema).default([]),
  total: z.number().default(0),
}).loose();

export const EMPTY_LIST_PROJECTS_RESPONSE: ListProjectsResponse = {
  projects: [],
  total: 0,
};

// Fallback for `GET /api/projects/{id}` when the response shape drifts.
// `id` defaults to empty — caller can detect "not found / drift" by checking
// `data.id === ""` and rendering an error state instead of pretending the
// data is valid. Status / priority cast to the enum literals so TS callers
// downstream still flow correctly; runtime values came from the schema
// (`z.string()`), which would have already passed.
export const EMPTY_PROJECT: Project = {
  id: "",
  workspace_id: "",
  title: "",
  description: null,
  icon: null,
  status: "planned",
  priority: "none",
  lead_type: null,
  lead_id: null,
  start_date: null,
  due_date: null,
  created_at: "",
  updated_at: "",
  issue_count: 0,
  done_count: 0,
  resource_count: 0,
};

// Project resources are typed pointers to external resources (today: GitHub
// repos). resource_ref shape varies per resource_type; lenient on both
// `resource_type` (so a future type doesn't crash the list) and
// `resource_ref` (passes through unchanged for the renderer to dispatch on).
const ProjectResourceSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  workspace_id: z.string(),
  resource_type: z.string(),
  resource_ref: z.unknown(),
  label: z.string().nullable(),
  position: z.number().default(0),
  created_at: z.string(),
  created_by: z.string().nullable(),
}).loose();

export const ListProjectResourcesResponseSchema = z.object({
  resources: z.array(ProjectResourceSchema).default([]),
  total: z.number().default(0),
}).loose();

export const EMPTY_LIST_PROJECT_RESOURCES_RESPONSE: ListProjectResourcesResponse = {
  resources: [],
  total: 0,
};

// =====================================================
// Chat (sessions / messages / pending task)
// =====================================================
// Lenient on every field that's purely informational (status enum, timestamps,
// agent/creator ids). `.loose()` so server-added fields pass through. The two
// fields mobile keys behaviour on — `id` and `chat_session_id` — are required.

export const ChatSessionSchema: z.ZodType<ChatSession> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  agent_id: z.string().default(""),
  creator_id: z.string().default(""),
  title: z.string().default(""),
  // Enum drift defense (root CLAUDE.md "Enum drift downgrades, not crashes"):
  // unknown server values fall back to "active" so the row still renders.
  status: z.enum(["active", "archived"]).catch("active"),
  has_unread: z.boolean().default(false),
  // Unread assistant messages after the read cursor. Optional (not defaulted)
  // so the badge math can tell "older server didn't send it" from a real 0 —
  // the tab badge sums `unread_count ?? 0`, same rule as web's sidebar.
  unread_count: z.number().optional(),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
}).loose();

export const ChatSessionListSchema = z.array(ChatSessionSchema).default([]);

export const EMPTY_CHAT_SESSION_LIST: ChatSession[] = [];

// `attachments` carried for parity rendering only — v1 doesn't author them on
// mobile. AttachmentSchema is reused as-is.
export const ChatMessageSchema: z.ZodType<ChatMessage> = z.object({
  id: z.string(),
  chat_session_id: z.string(),
  // If the server ever introduces a third role, fall back to "assistant" so
  // the message renders (as a left-aligned bubble) instead of crashing the
  // list. Matches Enum drift defense.
  role: z.enum(["user", "assistant"]).catch("assistant"),
  content: z.string().default(""),
  task_id: z.string().nullable().default(null),
  created_at: z.string().default(""),
  attachments: z.array(AttachmentSchema).optional(),
  failure_reason: z.string().nullable().optional(),
  elapsed_ms: z.number().nullable().optional(),
  message_kind: z.enum(["message", "no_response"]).catch("message").optional(),
  // One malformed optional suggestion must not erase an otherwise valid
  // conversation. The server validates these too; this is mixed-version and
  // corrupted-cache defense at the mobile boundary.
  quick_actions: z.array(z.object({
    label: z.string(),
    prompt: z.string(),
    primary: z.boolean().optional(),
  }).loose()).catch([]).optional().default([]),
}).loose();

export const ChatMessageListSchema = z.array(ChatMessageSchema).default([]);

export const EMPTY_CHAT_MESSAGE_LIST: ChatMessage[] = [];

const ChatQueuedTaskSchema = z.object({
  task_id: z.string(),
  status: z.string().default("queued"),
  created_at: z.string().default(""),
  message_id: z.string().optional(),
  content: z.string().optional(),
}).loose();

const ChatQueuedTasksSchema = z.array(z.unknown()).transform((tasks) =>
  tasks.flatMap((task) => {
    const parsed = ChatQueuedTaskSchema.safeParse(task);
    return parsed.success ? [parsed.data] : [];
  }),
);

// All root fields are optional — server returns an empty object when no
// task is in flight. Ignore malformed queue rows without discarding a valid
// head, matching packages/core/api/schemas.ts.
export const ChatPendingTaskSchema: z.ZodType<ChatPendingTask> = z.object({
  task_id: z.string().optional(),
  status: z.string().optional(),
  created_at: z.string().optional(),
  supports_queue: z.boolean().optional(),
  queued_tasks: ChatQueuedTasksSchema.optional(),
}).loose();

export const EMPTY_CHAT_PENDING_TASK: ChatPendingTask = {};

export const SendChatMessageResponseSchema: z.ZodType<SendChatMessageResponse> = z.object({
  message_id: z.string(),
  task_id: z.string(),
  supports_queue: z.boolean().optional(),
  queued: z.boolean().optional().catch(undefined),
  created_at: z.string().default(""),
}).loose();

// Live timeline emitted by the agent runtime while a task is running. Each
// row is one execution step (thinking / tool_use / tool_result / text /
// error). Mirrors web's TaskMessagePayload type and the WS `task:message`
// payload so the mobile cache shape stays interchangeable with web's.
export const TaskMessagePayloadSchema: z.ZodType<TaskMessagePayload> = z.object({
  task_id: z.string(),
  issue_id: z.string().default(""),
  chat_session_id: z.string().optional(),
  seq: z.number().default(0),
  // Enum drift defense: unknown server-side types fall back to "text" so
  // the row still renders (as a plain markdown chunk) instead of crashing
  // the timeline. Matches root CLAUDE.md "Enum drift downgrades, not crashes".
  type: z
    .enum(["text", "thinking", "tool_use", "tool_result", "error"])
    .catch("text"),
  tool: z.string().optional(),
  content: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.string().optional(),
  created_at: z.string().optional(),
}).loose();

export const TaskMessageListSchema = z.array(TaskMessagePayloadSchema).default([]);

export const EMPTY_TASK_MESSAGE_LIST: TaskMessagePayload[] = [];

// =====================================================
// Search (issues + projects)
// =====================================================
// Mirrors SearchIssueResult / SearchProjectResult in packages/core/types/api.ts.
// Web does not currently route search responses through parseWithFallback, so
// the schemas live mobile-side. Promote to core when web adopts the same
// defense.
//
// match_source is the server's hint of which field matched. Enum-drift defense
// (root CLAUDE.md "Enum drift downgrades, not crashes"): unknown values fall
// back to "title" so the row still renders without a snippet line.

const SearchIssueResultSchema = IssueSchema.safeExtend({
  match_source: z.enum(["title", "description", "comment"]).catch("title"),
  matched_snippet: z.string().optional(),
});

export const SearchIssuesResponseSchema = z.object({
  issues: z.array(SearchIssueResultSchema).default([]),
  total: z.number().default(0),
}).loose();

export const EMPTY_SEARCH_ISSUES_RESPONSE: SearchIssuesResponse = {
  issues: [],
  total: 0,
};

const SearchProjectResultSchema = ProjectSchema.safeExtend({
  match_source: z.enum(["title", "description"]).catch("title"),
  matched_snippet: z.string().optional(),
});

export const SearchProjectsResponseSchema = z.object({
  projects: z.array(SearchProjectResultSchema).default([]),
  total: z.number().default(0),
}).loose();

export const EMPTY_SEARCH_PROJECTS_RESPONSE: SearchProjectsResponse = {
  projects: [],
  total: 0,
};

// =====================================================
// Agent tasks (per-issue runs, active + history)
// =====================================================
// Mirrors AgentTask in packages/core/types/agent.ts. Backend handlers:
//   GET  /api/issues/{id}/active-task → { tasks: AgentTask[] } (may be empty)
//   GET  /api/issues/{id}/task-runs   → AgentTask[]
// Lenient on every field — status / kind / failure_reason all use `.catch()`
// so a future server-side enum value renders a generic fallback rather than
// crashing the row (root CLAUDE.md "Enum drift downgrades, not crashes").

export const AgentTaskSchema: z.ZodType<AgentTask> = z.object({
  id: z.string(),
  agent_id: z.string().default(""),
  runtime_id: z.string().default(""),
  issue_id: z.string().default(""),
  status: z
    .enum(["queued", "dispatched", "running", "completed", "failed", "cancelled"])
    .catch("queued"),
  priority: z.number().default(0),
  dispatched_at: z.string().nullable().default(null),
  started_at: z.string().nullable().default(null),
  completed_at: z.string().nullable().default(null),
  result: z.unknown().default(null),
  error: z.string().nullable().default(null),
  // Backend uses empty string ("") as the "not failed" sentinel (Go
  // `omitempty` on a custom string-typed enum). Normalize that to `undefined`
  // so downstream truthy checks (`if (task.failure_reason)`) don't have to
  // special-case both null/undefined AND "".
  failure_reason: z
    .enum(["agent_error", "timeout", "runtime_offline", "runtime_recovery", "manual", ""])
    .optional()
    .catch("")
    .transform((v) => (v === "" ? undefined : v)),
  created_at: z.string().default(""),
  chat_session_id: z.string().optional(),
  autopilot_run_id: z.string().optional(),
  parent_task_id: z.string().optional(),
  attempt: z.number().optional(),
  trigger_comment_id: z.string().optional(),
  trigger_summary: z.string().optional(),
  kind: z.enum(["comment", "autopilot", "chat", "quick_create", "direct"]).optional().catch("direct"),
  work_dir: z.string().optional(),
}).loose();

export const AgentTaskListSchema = z.array(AgentTaskSchema).default([]);

export const ActiveTasksResponseSchema = z.object({
  tasks: z.array(AgentTaskSchema).default([]),
}).loose();

export interface ActiveTasksResponse {
  tasks: AgentTask[];
}

export const EMPTY_AGENT_TASK_LIST: AgentTask[] = [];
export const EMPTY_ACTIVE_TASKS_RESPONSE: ActiveTasksResponse = { tasks: [] };

// =====================================================
// Issue subscriptions
// =====================================================
// Who is subscribed to an issue and why (`reason`). Server-driven and
// open-ended (core/types/subscriber.ts): `delegated` means an agent created
// the issue on the member's behalf — the UI must explain that subscription.
// Treat an unrecognised reason as a direct subscription rather than dropping
// the row, matching core's policy.

export const IssueSubscriberSchema = z.object({
  issue_id: z.string(),
  user_type: z.string(),
  user_id: z.string(),
  reason: z.string().default("manual"),
  created_at: z.string(),
}).loose();

export const IssueSubscriberListSchema = z
  .array(IssueSubscriberSchema)
  .default([]);

export const EMPTY_ISSUE_SUBSCRIBER_LIST: IssueSubscriber[] = [];

// Subscribe / unsubscribe mutations answer the *resulting* state
// (`{"subscribed": true}`), and core's client discards it. Mobile keeps it so
// tests can assert the caller-visible transition without a follow-up fetch.
export const SubscribeStatusSchema = z
  .object({ subscribed: z.boolean().default(false) })
  .loose();

export interface SubscribeStatusResponse {
  subscribed: boolean;
}

// =====================================================
// User / Workspace / Inbox / Member / Agent
// =====================================================
// Mobile reads these on every cold start (auth → workspaces → inbox → members
// → agents form the boot sequence). A schema drift in any of them used to
// cascade — getMe failure flushed the user, listWorkspaces failure landed the
// app on the workspace picker with no entries. With parseWithFallback every
// drift downgrades to "stale defaults render", and the user can keep working.
//
// All five are `.loose()` so additive backend fields (`onboarded_at` style
// flags) pass through without breaking parsing. Required identity fields
// (id, slug, etc.) stay required — a response that genuinely lacks them is
// unusable and parseWithFallback should fall back to the empty sentinel.

export const UserSchema: z.ZodType<User> = z.object({
  id: z.string(),
  name: z.string().default(""),
  email: z.string().default(""),
  avatar_url: z.string().nullable().default(null),
  onboarded_at: z.string().nullable().default(null),
  onboarding_questionnaire: z.record(z.string(), z.unknown()).default({}),
  starter_content_state: z.string().nullable().default(null),
  language: z.string().nullable().default(null),
  profile_description: z.string().default(""),
  timezone: z.string().nullable().default(null),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
}).loose();

// `id: ""` is the sentinel for "drifted / unauthenticated"; downstream code
// that switches on `user.id` will treat empty-string as a logged-out state
// (the auth hook also clears the cache on 401, so this is rarely seen).
export const EMPTY_USER: User = {
  id: "",
  name: "",
  email: "",
  avatar_url: null,
  onboarded_at: null,
  onboarding_questionnaire: {},
  starter_content_state: null,
  language: null,
  profile_description: "",
  timezone: null,
  created_at: "",
  updated_at: "",
};

export const WorkspaceSchema: z.ZodType<Workspace> = z.object({
  id: z.string(),
  name: z.string().default(""),
  slug: z.string().default(""),
  description: z.string().nullable().default(null),
  context: z.string().nullable().default(null),
  settings: z.record(z.string(), z.unknown()).default({}),
  repos: z.array(z.object({ url: z.string() }).loose()).default([]),
  issue_prefix: z.string().default(""),
  avatar_url: z.string().nullable().default(null),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
}).loose();

export const WorkspaceListSchema = z.array(WorkspaceSchema).default([]);
export const EMPTY_WORKSPACE_LIST: Workspace[] = [];

/** Pin metadata only — display fields (title / status / icon) are NOT here,
 *  consumers derive them from `issueDetailOptions` / `projectDetailOptions`.
 *  Matches the design in packages/core/types/pin.ts. */
export const PinnedItemSchema: z.ZodType<PinnedItem> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  user_id: z.string().default(""),
  item_type: z.enum(["issue", "project"]).catch("issue"),
  item_id: z.string(),
  position: z.number().default(0),
  created_at: z.string().default(""),
}).loose();

export const PinListSchema = z.array(PinnedItemSchema).default([]);
export const EMPTY_PIN_LIST: PinnedItem[] = [];

const InboxItemSchema: z.ZodType<InboxItem> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  // Recipient is always a real actor in the dataset, but defend against
  // either field going missing — mobile's actor lookup tolerates null.
  recipient_type: z.enum(["member", "agent"]).catch("member"),
  recipient_id: z.string().default(""),
  // `actor_type` includes "system" for platform-triggered notifications
  // (packages/core/types/inbox.ts:28). ActorAvatar handles all three plus
  // null. Enum drift falls back to null so the row still renders without an
  // avatar instead of crashing the list.
  actor_type: z
    .enum(["member", "agent", "system"])
    .nullable()
    .catch(null),
  actor_id: z.string().nullable().default(null),
  // `type` discriminates the rendered detail-label. Unknown values pass
  // through as raw strings — `InboxDetailLabel` has a default branch that
  // shows the raw type as fallback (components/inbox/detail-label.tsx).
  type: z.string() as unknown as z.ZodType<InboxItem["type"]>,
  severity: z
    .enum(["action_required", "attention", "info"])
    .catch("info"),
  issue_id: z.string().nullable().default(null),
  title: z.string().default(""),
  body: z.string().nullable().default(null),
  issue_status: z.string().nullable().default(null) as unknown as z.ZodType<
    InboxItem["issue_status"]
  >,
  read: z.boolean().default(false),
  archived: z.boolean().default(false),
  created_at: z.string().default(""),
  details: z.record(z.string(), z.string()).nullable().default(null),
}).loose();

export const InboxListSchema = z.array(InboxItemSchema).default([]);
export const EMPTY_INBOX_LIST: InboxItem[] = [];

export const MemberWithUserSchema: z.ZodType<MemberWithUser> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  user_id: z.string().default(""),
  role: z.enum(["owner", "admin", "member"]).catch("member"),
  created_at: z.string().default(""),
  name: z.string().default(""),
  email: z.string().default(""),
  avatar_url: z.string().nullable().default(null),
}).loose();

export const MemberListSchema = z.array(MemberWithUserSchema).default([]);
export const EMPTY_MEMBER_LIST: MemberWithUser[] = [];

export const InvitationSchema: z.ZodType<Invitation> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  inviter_id: z.string().default(""),
  invitee_email: z.string().default(""),
  invitee_user_id: z.string().nullable().default(null),
  role: z.enum(["owner", "admin", "member"]).catch("member"),
  status: z
    .enum(["pending", "accepted", "declined", "expired"])
    .catch("pending")
    .default("pending"),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
  expires_at: z.string().default(""),
  inviter_name: z.string().optional(),
  inviter_email: z.string().optional(),
  workspace_name: z.string().optional(),
}).loose();

export const EMPTY_INVITATION: Invitation = {
  id: "",
  workspace_id: "",
  inviter_id: "",
  invitee_email: "",
  invitee_user_id: null,
  role: "member",
  status: "pending",
  created_at: "",
  updated_at: "",
  expires_at: "",
};

export const InvitationListSchema = z.array(InvitationSchema).default([]);
export const EMPTY_INVITATION_LIST: Invitation[] = [];

const AgentInvocationTargetSchema: z.ZodType<AgentInvocationTarget> = z
  .object({
    target_type: z.enum(["workspace", "member", "team"]).catch("team"),
    target_id: z
      .string()
      .nullable()
      .optional()
      .catch(null)
      .transform((v) => v ?? null),
  })
  .loose();

// Agent schema is loose on every enum / structural field — the agent table is
// where new modes/visibilities/statuses get added most often. We need only id,
// name, avatar_url, and a couple of flags for the assignee picker + chat
// header; everything else is informational and safe to default.
export const AgentSchema: z.ZodType<Agent> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  runtime_id: z.string().default(""),
  runtime_bound: z.boolean().optional(),
  name: z.string().default(""),
  description: z.string().default(""),
  instructions: z.string().default(""),
  avatar_url: z.string().nullable().default(null),
  runtime_mode: z.string().catch("daemon") as unknown as z.ZodType<
    Agent["runtime_mode"]
  >,
  runtime_config: z.record(z.string(), z.unknown()).default({}),
  custom_args: z.array(z.string()).default([]),
  // MUL-2600: agent resource shape no longer carries custom_env or
  // custom_env_redacted. Mobile keeps only the coarse metadata that
  // mirrors web's expectations (the env screen reads the key count here
  // and reveals real values only via the dedicated /env endpoint).
  has_custom_env: z.boolean().optional(),
  custom_env_key_count: z.number().optional(),
  visibility: z.string().catch("workspace") as unknown as z.ZodType<
    Agent["visibility"]
  >,
  permission_mode: z.enum(["private", "public_to"]).catch("private"),
  invocation_targets: z.array(AgentInvocationTargetSchema).default([]),
  status: z.string().catch("active") as unknown as z.ZodType<Agent["status"]>,
  max_concurrent_tasks: z.number().default(1),
  model: z.string().default(""),
  owner_id: z.string().nullable().default(null),
  skills: z.array(z.unknown()).default([]) as unknown as z.ZodType<
    Agent["skills"]
  >,
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
  archived_at: z.string().nullable().default(null),
  archived_by: z.string().nullable().default(null),
}).loose();

export const AgentListSchema = z.array(AgentSchema).default([]);
export const EMPTY_AGENT_LIST: Agent[] = [];

// Wire shape of `GET /api/agents/{id}/env` (MUL-2600). Kept deliberately
// distinct from `AgentSchema` so a read of /env can never be served from a
// generic agent cache by name confusion — the only field worth anything here
// is the plaintext map, served only to the owner / workspace owner+admin.
export const AgentEnvSchema: z.ZodType<AgentEnvResponse> = z
  .object({
    agent_id: z.string().default(""),
    custom_env: z.record(z.string(), z.string()).default({}),
  })
  .loose();
export const EMPTY_AGENT_ENV: AgentEnvResponse = { agent_id: "", custom_env: {} };

// Runtime device — the daemon (local or cloud) an agent binds to. Mobile reads
// it for the presence dot: `status` + `last_seen_at` drive the three-state
// availability derivation in @multica/core/agents/derive-presence. All other
// fields default safely so a backend that adds optional new metadata
// (timezone, visibility flags, etc.) doesn't break the parse.
export const RuntimeSchema: z.ZodType<RuntimeDevice> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  daemon_id: z.string().nullable().default(null),
  name: z.string().default(""),
  runtime_mode: z.string().catch("local") as unknown as z.ZodType<
    RuntimeDevice["runtime_mode"]
  >,
  provider: z.string().default(""),
  launch_header: z.string().default(""),
  // The two fields presence derivation actually reads. Status defaults to
  // "offline" — a runtime row with an unparseable status is treated as
  // unreachable, which is the safe degrade for the dot.
  status: z.enum(["online", "offline"]).catch("offline"),
  last_seen_at: z.string().nullable().default(null),
  device_info: z.string().default(""),
  metadata: z.record(z.string(), z.unknown()).default({}),
  owner_id: z.string().nullable().default(null),
  visibility: z.string().catch("private") as unknown as z.ZodType<
    RuntimeDevice["visibility"]
  >,
  timezone: z.string().default(""),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
}).loose();

export const RuntimeListSchema = z.array(RuntimeSchema).default([]);
export const EMPTY_RUNTIME_LIST: RuntimeDevice[] = [];

// Squad schema — fields mobile actually consumes for the @mention suggestion
// bar (id, name, archived_at filter), the squad list/detail pages
// (member_count / member_preview / leader_id), plus identity/timestamp
// fields safe to default. `.loose()` so the server can add squad fields
// without breaking the parser.
export const SquadSchema: z.ZodType<Squad> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  name: z.string().default(""),
  description: z.string().default(""),
  instructions: z.string().default(""),
  avatar_url: z.string().nullable().default(null),
  leader_id: z.string().default(""),
  creator_id: z.string().default(""),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
  archived_at: z.string().nullable().default(null),
  archived_by: z.string().nullable().default(null),
  member_count: z.number().default(0),
  member_preview: z
    .array(
      z
        .object({
          member_type: z
            .string() as unknown as z.ZodType<SquadMemberPreview["member_type"]>,
          member_id: z.string().default(""),
          role: z.string().default(""),
        })
        .loose(),
    )
    .default([]),
}).loose();

export const SquadListSchema = z.array(SquadSchema).default([]);
export const EMPTY_SQUAD_LIST: Squad[] = [];

// Single squad membership row (GET/POST /api/squads/:id/members). Drift-safe
// defaults so a new server field can't collapse the detail roster.
export const SquadMemberSchema = z.object({
  id: z.string().default(""),
  squad_id: z.string().default(""),
  member_type: z.string().default("member"),
  member_id: z.string().default(""),
  role: z.string().default(""),
  created_at: z.string().default(""),
}).loose();

export const SquadMemberListSchema = z.array(SquadMemberSchema).default([]);
export const EMPTY_SQUAD_MEMBER_LIST: SquadMember[] = [];

// Per-member working/idle/offline/unstable/archived buckets (server derives
// in handler/squad.go). status is `string | null` (not the narrow union) so a
// new server bucket can't fail the parse — the UI renders a neutral pill.
const SquadMemberStatusSchema = z
  .object({
    member_type: z.string().default(""),
    member_id: z.string().default(""),
    status: z.string().nullable().default(null),
    active_issues: z
      .array(
        z
          .object({
            issue_id: z.string().default(""),
            identifier: z.string().default(""),
            title: z.string().default(""),
            issue_status: z.string().default(""),
          })
          .loose(),
      )
      .default([]),
    last_active_at: z.string().nullable().default(null),
  })
  .loose();

export const SquadMemberStatusListResponseSchema = z
  .object({
    members: z.array(SquadMemberStatusSchema).default([]),
  })
  .loose();

export const EMPTY_SQUAD_MEMBER_STATUS_LIST = { members: [] };

// Single-issue fallback used by getIssue. Mobile reuses IssueSchema from core
// for parsing; this sentinel lets parseWithFallback yield a structurally-
// valid Issue when the response drifts. `id: ""` flags drift downstream — the
// detail screen treats it as "issue not found" and shows the empty state.
export const EMPTY_ISSUE_FALLBACK: import("@multica/core/types").Issue = {
  id: "",
  workspace_id: "",
  number: 0,
  identifier: "",
  title: "",
  description: null,
  status: "backlog",
  priority: "none",
  assignee_type: null,
  assignee_id: null,
  creator_type: "member",
  creator_id: "",
  parent_issue_id: null,
  project_id: null,
  position: 0,
  stage: null,
  start_date: null,
  due_date: null,
  metadata: {},
  properties: {},
  created_at: "",
  updated_at: "",
};

// Child issues (direct sub-issues) of a parent — `GET /api/issues/:id/children`.
// Mirrors core's ChildIssuesResponseSchema (packages/core/api/schemas.ts:1135).
// `.default([])` keeps a missing `issues` key from taking the page down.
export const ChildIssuesResponseSchema = z.object({
  issues: z.array(IssueSchema).default([]),
}).loose();

// Fallback for the children response when the shape drifts. The list region
// treats `issues.length === 0` as "no sub-issues" and hides itself entirely.
export const EMPTY_CHILD_ISSUES_RESPONSE: {
  issues: import("@multica/core/types").Issue[];
} = {
  issues: [],
};

// ---------------------------------------------------------------------------
// Autopilot detail + runs schemas. The LIST endpoint is covered by core's
// ListAutopilotsResponseSchema (packages/core/api/schemas.ts:1821) and its
// run objects by core's AutopilotRunSchema — both imported from
// @multica/core/api/schemas by data/api.ts. Core ships no schema for the
// detail (GET /api/autopilots/:id) or runs-list (GET /api/autopilots/:id/
// runs) responses, so their shapes live here under the same drift rules:
// enums stay z.string(), .loose() tolerates unknown fields, defaults keep a
// reshaped response from taking the page down.
// ---------------------------------------------------------------------------

export const AutopilotTriggerSchema = z.object({
  id: z.string(),
  autopilot_id: z.string(),
  kind: z.string(),
  enabled: z.boolean(),
  cron_expression: z.string().nullable(),
  timezone: z.string().nullable(),
  next_run_at: z.string().nullable(),
  webhook_token: z.string().nullable(),
  // webhook_path/webhook_url absent on older servers — optional.
  webhook_path: z.string().nullable().optional(),
  webhook_url: z.string().nullable().optional(),
  label: z.string().nullable(),
  // event_filters only present for webhook triggers (accept-all otherwise).
  event_filters: z.unknown().nullable().optional(),
  last_fired_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}).loose();

// Detail endpoint response (GetAutopilotResponse). `subscribers` /
// `enough` fields only populate on detail; `can_write` / `can_manage_access`
// are absent on older servers — optional by contract.
export const AutopilotDetailSchema = z.object({
  autopilot: z
    .object({
      id: z.string(),
      workspace_id: z.string(),
      title: z.string(),
      description: z.string().nullable().optional(),
      project_id: z.string().nullable().optional(),
      // Pre-MUL-2429 servers omit assignee_type; "agent" is the default.
      assignee_type: z.string().default("agent"),
      assignee_id: z.string(),
      status: z.string(),
      execution_mode: z.string(),
      issue_title_template: z.string().nullable().optional(),
      created_by_type: z.string(),
      created_by_id: z.string(),
      last_run_at: z.string().nullable().optional(),
      created_at: z.string(),
      updated_at: z.string(),
      trigger_kinds: z.array(z.string()).optional(),
      next_run_at: z.string().nullable().optional(),
      last_run_status: z.string().nullable().optional(),
      can_write: z.boolean().optional(),
      can_manage_access: z.boolean().optional(),
      pause_reason: z.string().nullable().optional(),
      subscribers: z.unknown().nullable().optional(),
    })
    .loose(),
  // Only the detail endpoint populates triggers (list returns []).
  triggers: z.array(AutopilotTriggerSchema).default([]),
  // Members explicitly granted write access; absent on older servers.
  collaborators: z.unknown().nullable().optional(),
}).loose();

export const EMPTY_AUTOPILOT_DETAIL: {
  autopilot: {
    id: string;
    workspace_id: string;
    title: string;
    description: string | null | undefined;
    project_id: string | null | undefined;
    assignee_type: string;
    assignee_id: string;
    status: string;
    execution_mode: string;
    issue_title_template: string | null | undefined;
    created_by_type: string;
    created_by_id: string;
    last_run_at: string | null | undefined;
    created_at: string;
    updated_at: string;
    trigger_kinds: string[] | undefined;
    next_run_at: string | null | undefined;
    last_run_status: string | null | undefined;
    can_write: boolean | undefined;
    can_manage_access: boolean | undefined;
    pause_reason: string | null | undefined;
    subscribers: unknown | null | undefined;
  };
  triggers: AutopilotTrigger[];
  collaborators: unknown | null | undefined;
} = {
  autopilot: {
    id: "",
    workspace_id: "",
    title: "",
    description: null,
    project_id: null,
    assignee_type: "agent",
    assignee_id: "",
    status: "",
    execution_mode: "",
    issue_title_template: null,
    created_by_type: "",
    created_by_id: "",
    last_run_at: null,
    created_at: "",
    updated_at: "",
    trigger_kinds: undefined,
    next_run_at: null,
    last_run_status: null,
    can_write: undefined,
    can_manage_access: undefined,
    pause_reason: null,
    subscribers: null,
  },
  triggers: [],
  collaborators: null,
};

export const ListAutopilotRunsResponseSchema = z.object({
  runs: z.array(AutopilotRunSchema).default([]),
  total: z.number().default(0),
}).loose();

// Fallback for a rotated-webhook-token response that drifts: id stays empty
// so callers can detect "could not read the updated trigger" downstream.
// kind reads "webhook" because rotate is only offered on webhook triggers,
// so that is the only kind this fallback is ever handed out for.
export const EMPTY_AUTOPILOT_TRIGGER: AutopilotTrigger = {
  id: "",
  autopilot_id: "",
  kind: "webhook",
  enabled: false,
  cron_expression: null,
  timezone: null,
  next_run_at: null,
  webhook_token: null,
  webhook_path: null,
  webhook_url: null,
  label: null,
  event_filters: null,
  last_fired_at: null,
  created_at: "",
  updated_at: "",
};

// GET /api/autopilots/cron-preview — used by the schedule trigger form to
// pre-validate a cron expression before POST. `null` next_runs is the
// client-side sentinel for "unreadable response" (never "never fires").
export const CronPreviewResponseSchema = z.object({
  next_runs: z.array(z.string()).nullable().default(null),
}).loose();

export const EMPTY_CRON_PREVIEW_RESPONSE: CronPreviewResponse = {
  next_runs: null,
};

// ---------------------------------------------------------------------------
// Autopilot create/trigger FORM request contracts. Core ships these only as
// TS interfaces (packages/core/types/autopilot.ts) — no zod — so the form
// layer owns the zod contract that validates "the form state is shaped
// correctly before we POST" (drift defense: server enums stay z.string(),
// a reshaped payload must not reach the wire). The trigger form schema also
// covers edit mode (enabled absent → unchanged).
// ---------------------------------------------------------------------------

export const CreateAutopilotFormSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  project_id: z.string().nullable().optional(),
  assignee_type: z.string().default("agent"),
  assignee_id: z.string().min(1),
  execution_mode: z.string().min(1),
});

export const AutopilotTriggerFormSchema = z.object({
  kind: z.enum(["schedule", "webhook"]),
  cron_expression: z.string().optional(),
  timezone: z.string().optional(),
  label: z.string().optional(),
  enabled: z.boolean().optional(),
});

export type AutopilotTriggerFormValues = z.infer<
  typeof AutopilotTriggerFormSchema
>;

export const EMPTY_LIST_AUTOPILOT_RUNS_RESPONSE: {
  runs: AutopilotRun[];
  total: number;
} = {
  runs: [],
  total: 0,
};

// Helpers re-exported for ergonomic single-import at the call site.
export type { Label, Project, ProjectResource, Skill, SkillSummary };

// Skills. `SkillSchema` has drift defense (`.loose()` + defaults) in core —
// re-export it alongside a list-level schema so api.listSkills can apply
// the same defense to a bare `SkillSummary[]` payload.
export { SkillSchema, EMPTY_SKILL };

export const SkillListSchema = z.array(SkillSchema).default([]);
export const EMPTY_SKILL_LIST: SkillSummary[] = [];

// Workspace usage rollups (iteration-34 usage screen). Mirrors core's
// DashboardUsageDailySchema / DashboardUsageByAgentSchema field-for-field
// (packages/core/api/schemas.ts:1206) so the token buckets aggregate
// identically to web; numeric defaults degrade a drift response to zeros
// rather than crashing the page.
const CostSplitShape = {
  cost_usd_ticks: z.number().default(0),
  uncosted_input_tokens: z.number().default(0),
  uncosted_output_tokens: z.number().default(0),
  uncosted_cache_read_tokens: z.number().default(0),
  uncosted_cache_write_tokens: z.number().default(0),
};

export const DashboardUsageDailySchema: z.ZodType<DashboardUsageDaily> = z
  .object({
    date: z.string().default(""),
    provider: z.string().default(""),
    model: z.string().default(""),
    input_tokens: z.number().default(0),
    output_tokens: z.number().default(0),
    cache_read_tokens: z.number().default(0),
    cache_write_tokens: z.number().default(0),
    ...CostSplitShape,
    task_count: z.number().default(0),
  })
  .loose();

export const DashboardUsageDailyListSchema = z
  .array(DashboardUsageDailySchema)
  .default([]);

export const DashboardUsageByAgentSchema: z.ZodType<DashboardUsageByAgent> = z
  .object({
    agent_id: z.string().default(""),
    provider: z.string().default(""),
    model: z.string().default(""),
    input_tokens: z.number().default(0),
    output_tokens: z.number().default(0),
    cache_read_tokens: z.number().default(0),
    cache_write_tokens: z.number().default(0),
    ...CostSplitShape,
    task_count: z.number().default(0),
  })
  .loose();

export const DashboardUsageByAgentListSchema = z
  .array(DashboardUsageByAgentSchema)
  .default([]);

// Dashboard failure rollups (iteration-44 Errors tab). Mirrors core's
// DashboardFailureDailySchema / DashboardFailureByAgentSchema field-for-field
// (packages/core/api/schemas.ts:1265) — the empty `failure_reason` string is
// the *succeeded* bucket, so numeric defaults degrade a drift response to a
// zero-count row rather than inventing a failure.
export const DashboardFailureDailySchema: z.ZodType<DashboardFailureDaily> = z
  .object({
    date: z.string().default(""),
    failure_reason: z.string().default(""),
    task_count: z.number().default(0),
  })
  .loose();

export const DashboardFailureDailyListSchema = z
  .array(DashboardFailureDailySchema)
  .default([]);

export const EMPTY_DASHBOARD_FAILURE_DAILY: DashboardFailureDaily[] = [];

export const DashboardFailureByAgentSchema: z.ZodType<DashboardFailureByAgent> = z
  .object({
    agent_id: z.string().default(""),
    failure_reason: z.string().default(""),
    task_count: z.number().default(0),
  })
  .loose();

export const DashboardFailureByAgentListSchema = z
  .array(DashboardFailureByAgentSchema)
  .default([]);

export const EMPTY_DASHBOARD_FAILURE_BY_AGENT: DashboardFailureByAgent[] = [];

// Dashboard run-time rollups (iteration-45 Time/Tasks dimension). Mirrors
// core's DashboardAgentRunTimeSchema / DashboardRunTimeDailySchema
// field-for-field (packages/core/api/schemas.ts:1237) — cancelled_count
// defaults to 0 so a backend that predates cancellation still renders (those
// rows carry no cancelled segment, which is exactly what that backend
// measured).
export const DashboardAgentRunTimeSchema: z.ZodType<DashboardAgentRunTime> = z
  .object({
    agent_id: z.string().default(""),
    total_seconds: z.number().default(0),
    task_count: z.number().default(0),
    failed_count: z.number().default(0),
    cancelled_count: z.number().default(0),
  })
  .loose();

export const DashboardAgentRunTimeListSchema = z
  .array(DashboardAgentRunTimeSchema)
  .default([]);

export const EMPTY_DASHBOARD_AGENT_RUN_TIME: DashboardAgentRunTime[] = [];

export const DashboardRunTimeDailySchema: z.ZodType<DashboardRunTimeDaily> = z
  .object({
    date: z.string().default(""),
    total_seconds: z.number().default(0),
    task_count: z.number().default(0),
    failed_count: z.number().default(0),
    cancelled_count: z.number().default(0),
  })
  .loose();

export const DashboardRunTimeDailyListSchema = z
  .array(DashboardRunTimeDailySchema)
  .default([]);

export const EMPTY_DASHBOARD_RUN_TIME_DAILY: DashboardRunTimeDaily[] = [];

// Personal access tokens (account-level, mirrors packages/core/types/api.ts
// PersonalAccessToken). Lenient: nullable dates default to null so a drifted
// body degrades to a row with blank metadata instead of a crash.
const personalAccessTokenShape = {
  id: z.string().default(""),
  name: z.string().default(""),
  token_prefix: z.string().default(""),
  expires_at: z.string().nullable().default(null),
  last_used_at: z.string().nullable().default(null),
  created_at: z.string().default(""),
};

export const PersonalAccessTokenSchema: z.ZodType<PersonalAccessToken> = z
  .object(personalAccessTokenShape)
  .loose();

export const PersonalAccessTokenListSchema = z
  .array(PersonalAccessTokenSchema)
  .default([]);

export const CreatePersonalAccessTokenResponseSchema: z.ZodType<CreatePersonalAccessTokenResponse> =
  z
    .object({ ...personalAccessTokenShape, token: z.string().default("") })
    .loose();

/** One workspace MCP server library / agent-assignment entry (mirrors
 *  packages/core/api/schemas.ts WorkspaceMcpServerSchema + GH #6062). The
 *  API is deliberately write-only: only identity + transport round-trip, the
 *  stored `config` never returns. `enabled` is present only on an agent's
 *  assignment list (the per-binding toggle); the library listing omits it.
 *  `.loose()` so a newer server can add fields without breaking mobile. */
export const WorkspaceMcpServerSchema: z.ZodType<WorkspaceMcpServer> = z
  .object({
    id: z.string().default(""),
    workspace_id: z.string().default(""),
    name: z.string().default(""),
    transport: z.string().default("unknown"),
    enabled: z.boolean().optional(),
    created_at: z.string().default(""),
    updated_at: z.string().default(""),
  })
  .loose();

export const WorkspaceMcpServerListSchema = z
  .array(WorkspaceMcpServerSchema)
  .default([]);

export const EMPTY_WORKSPACE_MCP_SERVER: WorkspaceMcpServer = {
  id: "",
  workspace_id: "",
  name: "",
  transport: "unknown",
  created_at: "",
  updated_at: "",
};

export const EMPTY_WORKSPACE_MCP_SERVER_LIST: WorkspaceMcpServer[] = [];
