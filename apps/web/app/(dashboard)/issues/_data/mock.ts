import type { IssueStatus, IssuePriority } from "@multica/types";

// ---------------------------------------------------------------------------
// Extended types for mock UI
// ---------------------------------------------------------------------------

export interface MockAssignee {
  id: string;
  name: string;
  avatar: string;
  type: "member" | "agent";
}

export interface MockComment {
  id: string;
  author: MockAssignee;
  body: string;
  createdAt: string;
}

export interface MockActivity {
  id: string;
  actor: MockAssignee;
  action: string;
  createdAt: string;
}

export interface MockIssue {
  id: string;
  key: string;
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  assignee: MockAssignee | null;
  creator: MockAssignee;
  dueDate: string | null;
  comments: MockComment[];
  activity: MockActivity[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// People & Agents
// ---------------------------------------------------------------------------

export const PEOPLE: Record<string, MockAssignee> = {
  jiayuan: { id: "usr_1", name: "Jiayuan", avatar: "JY", type: "member" },
  bohan: { id: "usr_2", name: "Bohan", avatar: "BH", type: "member" },
  yuzhen: { id: "usr_3", name: "Yuzhen", avatar: "YZ", type: "member" },
  claude1: { id: "agent_1", name: "Claude-1", avatar: "C1", type: "agent" },
  codex1: { id: "agent_2", name: "Codex-1", avatar: "CX", type: "agent" },
  reviewBot: { id: "agent_3", name: "Review Bot", avatar: "RB", type: "agent" },
};

// ---------------------------------------------------------------------------
// Status & Priority config
// ---------------------------------------------------------------------------

export const STATUS_ORDER: IssueStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
];

export const STATUS_CONFIG: Record<
  IssueStatus,
  { label: string; iconColor: string }
> = {
  backlog: { label: "Backlog", iconColor: "text-muted-foreground" },
  todo: { label: "Todo", iconColor: "text-muted-foreground" },
  in_progress: { label: "In Progress", iconColor: "text-yellow-500" },
  in_review: { label: "In Review", iconColor: "text-blue-500" },
  done: { label: "Done", iconColor: "text-green-500" },
  blocked: { label: "Blocked", iconColor: "text-red-500" },
  cancelled: { label: "Cancelled", iconColor: "text-muted-foreground/50" },
};

export const PRIORITY_CONFIG: Record<
  IssuePriority,
  { label: string; bars: number; color: string }
> = {
  urgent: { label: "Urgent", bars: 4, color: "text-orange-500" },
  high: { label: "High", bars: 3, color: "text-orange-400" },
  medium: { label: "Medium", bars: 2, color: "text-yellow-500" },
  low: { label: "Low", bars: 1, color: "text-blue-400" },
  none: { label: "No priority", bars: 0, color: "text-muted-foreground" },
};

// ---------------------------------------------------------------------------
// Mock Issues
// ---------------------------------------------------------------------------

const { jiayuan, bohan, yuzhen, claude1, codex1, reviewBot } = PEOPLE;

export const MOCK_ISSUES: MockIssue[] = [
  // ---- Backlog ----
  {
    id: "iss_20",
    key: "MUL-20",
    title: "Add multi-workspace support",
    description:
      "Allow users to create and switch between multiple workspaces. Each workspace should have isolated issues, agents, and knowledge base.",
    status: "backlog",
    priority: "low",
    assignee: null,
    creator: jiayuan,
    dueDate: null,
    comments: [],
    activity: [
      { id: "act_20_1", actor: jiayuan, action: "created this issue", createdAt: "2026-03-18T10:00:00Z" },
    ],
    createdAt: "2026-03-18T10:00:00Z",
    updatedAt: "2026-03-18T10:00:00Z",
  },
  {
    id: "iss_21",
    key: "MUL-21",
    title: "Agent long-term memory persistence",
    description:
      "Implement a memory system for agents that persists across task executions. Should support both vector embeddings and structured key-value storage.",
    status: "backlog",
    priority: "medium",
    assignee: null,
    creator: bohan,
    dueDate: null,
    comments: [],
    activity: [
      { id: "act_21_1", actor: bohan, action: "created this issue", createdAt: "2026-03-19T08:00:00Z" },
    ],
    createdAt: "2026-03-19T08:00:00Z",
    updatedAt: "2026-03-19T08:00:00Z",
  },

  // ---- Todo ----
  {
    id: "iss_15",
    key: "MUL-15",
    title: "Design the agent config UI",
    description:
      "We need a configuration panel where users can set up their local agents — select runtime type, set concurrency limits, and manage API keys. This should live in the Settings page for now.",
    status: "todo",
    priority: "high",
    assignee: jiayuan,
    creator: bohan,
    dueDate: "2026-03-25T00:00:00Z",
    comments: [
      {
        id: "cmt_15_1",
        author: bohan,
        body: "Let's keep this simple for MVP — just runtime selection and concurrency slider.",
        createdAt: "2026-03-20T09:00:00Z",
      },
    ],
    activity: [
      { id: "act_15_1", actor: bohan, action: "created this issue", createdAt: "2026-03-20T08:00:00Z" },
      { id: "act_15_2", actor: bohan, action: "assigned this to Jiayuan", createdAt: "2026-03-20T08:00:00Z" },
      { id: "act_15_3", actor: bohan, action: "set priority to High", createdAt: "2026-03-20T08:01:00Z" },
    ],
    createdAt: "2026-03-20T08:00:00Z",
    updatedAt: "2026-03-20T09:00:00Z",
  },
  {
    id: "iss_16",
    key: "MUL-16",
    title: "Implement knowledge base document editor",
    description:
      "Build a Markdown editor for creating and editing knowledge base documents. Should support basic formatting, code blocks, and image uploads.",
    status: "todo",
    priority: "medium",
    assignee: codex1,
    creator: yuzhen,
    dueDate: "2026-03-28T00:00:00Z",
    comments: [],
    activity: [
      { id: "act_16_1", actor: yuzhen, action: "created this issue", createdAt: "2026-03-19T14:00:00Z" },
      { id: "act_16_2", actor: yuzhen, action: "assigned this to Codex-1", createdAt: "2026-03-19T14:01:00Z" },
    ],
    createdAt: "2026-03-19T14:00:00Z",
    updatedAt: "2026-03-19T14:01:00Z",
  },
  {
    id: "iss_17",
    key: "MUL-17",
    title: "Add issue dependency tracking",
    description: "Support blocking/blocked-by relationships between issues. Show dependency graph in issue detail view.",
    status: "todo",
    priority: "low",
    assignee: null,
    creator: jiayuan,
    dueDate: null,
    comments: [],
    activity: [
      { id: "act_17_1", actor: jiayuan, action: "created this issue", createdAt: "2026-03-20T11:00:00Z" },
    ],
    createdAt: "2026-03-20T11:00:00Z",
    updatedAt: "2026-03-20T11:00:00Z",
  },

  // ---- In Progress ----
  {
    id: "iss_9",
    key: "MUL-9",
    title: "Implement issue list API endpoint",
    description:
      "Build the REST API endpoint for listing and filtering issues.\n\n## Requirements\n- Pagination with cursor-based approach\n- Filter by status, priority, assignee\n- Sort by priority, status, created_at\n- Include assignee info in response",
    status: "in_progress",
    priority: "high",
    assignee: claude1,
    creator: jiayuan,
    dueDate: "2026-03-22T00:00:00Z",
    comments: [
      {
        id: "cmt_9_1",
        author: claude1,
        body: "Started working on this. Using sqlc for the query generation. I'll implement cursor-based pagination with the `created_at` + `id` compound cursor.",
        createdAt: "2026-03-20T14:00:00Z",
      },
      {
        id: "cmt_9_2",
        author: jiayuan,
        body: "Sounds good. Make sure to add an index on (status, created_at) for the filtered queries.",
        createdAt: "2026-03-20T14:30:00Z",
      },
    ],
    activity: [
      { id: "act_9_1", actor: jiayuan, action: "created this issue", createdAt: "2026-03-19T10:00:00Z" },
      { id: "act_9_2", actor: jiayuan, action: "assigned this to Claude-1", createdAt: "2026-03-19T10:00:00Z" },
      { id: "act_9_3", actor: claude1, action: "moved this to In Progress", createdAt: "2026-03-20T13:00:00Z" },
    ],
    createdAt: "2026-03-19T10:00:00Z",
    updatedAt: "2026-03-20T14:30:00Z",
  },
  {
    id: "iss_12",
    key: "MUL-12",
    title: "Implement OAuth login flow",
    description:
      "Set up Google OAuth for user authentication. Include PKCE flow for the SPA and session management on the server side.",
    status: "in_progress",
    priority: "urgent",
    assignee: claude1,
    creator: jiayuan,
    dueDate: "2026-03-21T00:00:00Z",
    comments: [
      {
        id: "cmt_12_1",
        author: claude1,
        body: "I need clarification on the authentication flow. The current OAuth implementation uses PKCE, but the design doc references a session-based approach. Which one should I follow?",
        createdAt: "2026-03-21T05:32:00Z",
      },
    ],
    activity: [
      { id: "act_12_1", actor: jiayuan, action: "created this issue", createdAt: "2026-03-18T09:00:00Z" },
      { id: "act_12_2", actor: jiayuan, action: "assigned this to Claude-1", createdAt: "2026-03-18T09:01:00Z" },
      { id: "act_12_3", actor: claude1, action: "moved this to In Progress", createdAt: "2026-03-20T10:00:00Z" },
      { id: "act_12_4", actor: claude1, action: "marked as Blocked", createdAt: "2026-03-21T05:32:00Z" },
    ],
    createdAt: "2026-03-18T09:00:00Z",
    updatedAt: "2026-03-21T05:32:00Z",
  },
  {
    id: "iss_10",
    key: "MUL-10",
    title: "Set up pgvector for knowledge base embeddings",
    description:
      "Configure pgvector extension and create the embeddings table for semantic search in the knowledge base.",
    status: "in_progress",
    priority: "medium",
    assignee: yuzhen,
    creator: yuzhen,
    dueDate: "2026-03-24T00:00:00Z",
    comments: [
      {
        id: "cmt_10_1",
        author: yuzhen,
        body: "@jiayuan Can you take a look at the database schema? I want to make sure the vector embeddings table is set up correctly before we start indexing.",
        createdAt: "2026-03-20T18:30:00Z",
      },
    ],
    activity: [
      { id: "act_10_1", actor: yuzhen, action: "created this issue", createdAt: "2026-03-19T11:00:00Z" },
      { id: "act_10_2", actor: yuzhen, action: "moved this to In Progress", createdAt: "2026-03-20T09:00:00Z" },
    ],
    createdAt: "2026-03-19T11:00:00Z",
    updatedAt: "2026-03-20T18:30:00Z",
  },
  {
    id: "iss_14",
    key: "MUL-14",
    title: "Add WebSocket event types for agent status",
    description: "Define and implement WebSocket message types for real-time agent status updates (idle, working, blocked, error, offline).",
    status: "in_progress",
    priority: "high",
    assignee: bohan,
    creator: bohan,
    dueDate: "2026-03-23T00:00:00Z",
    comments: [],
    activity: [
      { id: "act_14_1", actor: bohan, action: "created this issue", createdAt: "2026-03-20T08:00:00Z" },
      { id: "act_14_2", actor: bohan, action: "moved this to In Progress", createdAt: "2026-03-20T16:00:00Z" },
    ],
    createdAt: "2026-03-20T08:00:00Z",
    updatedAt: "2026-03-20T16:00:00Z",
  },

  // ---- In Review ----
  {
    id: "iss_8",
    key: "MUL-8",
    title: "Add WebSocket reconnection logic",
    description:
      "Implement exponential backoff for WebSocket reconnection in the daemon. Include configurable max retry attempts.",
    status: "in_review",
    priority: "high",
    assignee: codex1,
    creator: bohan,
    dueDate: "2026-03-21T00:00:00Z",
    comments: [
      {
        id: "cmt_8_1",
        author: codex1,
        body: "PR #47 submitted. Chose exponential backoff over linear retry because of the bursty reconnection pattern observed in daemon logs.",
        createdAt: "2026-03-21T04:00:00Z",
      },
      {
        id: "cmt_8_2",
        author: reviewBot,
        body: "Code review passed. No security issues found. Minor suggestion: consider adding jitter to the backoff to avoid thundering herd.",
        createdAt: "2026-03-21T04:30:00Z",
      },
    ],
    activity: [
      { id: "act_8_1", actor: bohan, action: "created this issue", createdAt: "2026-03-17T10:00:00Z" },
      { id: "act_8_2", actor: bohan, action: "assigned this to Codex-1", createdAt: "2026-03-17T10:01:00Z" },
      { id: "act_8_3", actor: codex1, action: "moved this to In Progress", createdAt: "2026-03-19T08:00:00Z" },
      { id: "act_8_4", actor: codex1, action: "moved this to In Review", createdAt: "2026-03-21T04:00:00Z" },
    ],
    createdAt: "2026-03-17T10:00:00Z",
    updatedAt: "2026-03-21T04:30:00Z",
  },
  {
    id: "iss_11",
    key: "MUL-11",
    title: "Implement inbox notification API",
    description: "Build REST endpoints for inbox CRUD — list, mark read, archive. Include filtering by severity and type.",
    status: "in_review",
    priority: "medium",
    assignee: claude1,
    creator: jiayuan,
    dueDate: "2026-03-22T00:00:00Z",
    comments: [
      {
        id: "cmt_11_1",
        author: claude1,
        body: "PR #48 is ready. All tests pass, including the new integration tests for batch mark-as-read.",
        createdAt: "2026-03-21T02:00:00Z",
      },
    ],
    activity: [
      { id: "act_11_1", actor: jiayuan, action: "created this issue", createdAt: "2026-03-18T14:00:00Z" },
      { id: "act_11_2", actor: jiayuan, action: "assigned this to Claude-1", createdAt: "2026-03-18T14:00:00Z" },
      { id: "act_11_3", actor: claude1, action: "moved this to In Review", createdAt: "2026-03-21T02:00:00Z" },
    ],
    createdAt: "2026-03-18T14:00:00Z",
    updatedAt: "2026-03-21T02:00:00Z",
  },

  // ---- Done ----
  {
    id: "iss_3",
    key: "MUL-3",
    title: "Set up CI/CD pipeline",
    description: "Configure GitHub Actions for build, test, and lint on every push to main.",
    status: "done",
    priority: "high",
    assignee: bohan,
    creator: bohan,
    dueDate: "2026-03-18T00:00:00Z",
    comments: [],
    activity: [
      { id: "act_3_1", actor: bohan, action: "created this issue", createdAt: "2026-03-15T09:00:00Z" },
      { id: "act_3_2", actor: bohan, action: "moved this to Done", createdAt: "2026-03-20T15:00:00Z" },
    ],
    createdAt: "2026-03-15T09:00:00Z",
    updatedAt: "2026-03-20T15:00:00Z",
  },
  {
    id: "iss_6",
    key: "MUL-6",
    title: "Standardize API error handling",
    description: "Create a consistent error response format across all API endpoints. Add error codes enum and panic recovery middleware.",
    status: "done",
    priority: "medium",
    assignee: claude1,
    creator: jiayuan,
    dueDate: "2026-03-20T00:00:00Z",
    comments: [
      {
        id: "cmt_6_1",
        author: claude1,
        body: "All acceptance criteria passed. PR #45 created and CI is green.",
        createdAt: "2026-03-20T22:10:00Z",
      },
    ],
    activity: [
      { id: "act_6_1", actor: jiayuan, action: "created this issue", createdAt: "2026-03-16T10:00:00Z" },
      { id: "act_6_2", actor: jiayuan, action: "assigned this to Claude-1", createdAt: "2026-03-16T10:00:00Z" },
      { id: "act_6_3", actor: claude1, action: "moved this to Done", createdAt: "2026-03-20T22:10:00Z" },
    ],
    createdAt: "2026-03-16T10:00:00Z",
    updatedAt: "2026-03-20T22:10:00Z",
  },
  {
    id: "iss_1",
    key: "MUL-1",
    title: "Initialize monorepo structure",
    description: "Set up the polyglot monorepo with Go backend, Next.js frontend, and shared TypeScript packages.",
    status: "done",
    priority: "urgent",
    assignee: jiayuan,
    creator: jiayuan,
    dueDate: "2026-03-15T00:00:00Z",
    comments: [],
    activity: [
      { id: "act_1_1", actor: jiayuan, action: "created this issue", createdAt: "2026-03-14T08:00:00Z" },
      { id: "act_1_2", actor: jiayuan, action: "moved this to Done", createdAt: "2026-03-15T18:00:00Z" },
    ],
    createdAt: "2026-03-14T08:00:00Z",
    updatedAt: "2026-03-15T18:00:00Z",
  },
];
