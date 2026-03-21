export interface KBDocument {
  id: string;
  title: string;
  content: string;
  createdBy: string;
  updatedAt: string;
  referencedBy: string[];
}

export const MOCK_DOCUMENTS: KBDocument[] = [
  {
    id: "kb_1",
    title: "Product Vision & Positioning",
    content: `Multica is an AI-native task management platform — like Linear, but with AI agents as first-class citizens.

## Target Users

- 2–10 person technical teams / startups
- Teams that already use AI coding agents daily (Claude Code, Codex, etc.)
- Current toolchain: Linear/GitHub Issues + Claude Code/Codex + GitHub + IM

## Core Value Proposition

| Dimension | Existing Tools (Linear) | Multica |
|-----------|------------------------|---------|
| Task executor | Humans only | Humans + Agents |
| Context | Manual copy-paste | Auto-aggregated, agents read directly |
| Task flow | Human-driven status changes | Agents auto-flow + notify humans when decisions needed |
| Concurrency | Limited by team size | Parallel agent dispatch |

## What We Are NOT

- Not a general-purpose project management tool (no Gantt charts, resource planning)
- Not an AI agent framework (we orchestrate, not build agents)
- Not a chat product (Inbox is action-oriented, not conversational)`,
    createdBy: "Jiayuan",
    updatedAt: "2026-03-20T10:00:00Z",
    referencedBy: ["MUL-1"],
  },
  {
    id: "kb_2",
    title: "Architecture Overview",
    content: `## System Architecture

Polyglot monorepo — Go backend + TypeScript frontend.

\`\`\`
server/       — Go backend (Chi + sqlc + gorilla/websocket)
apps/web/     — Next.js 16 frontend
packages/     — Shared TypeScript packages (ui, types, sdk, store, hooks, utils)
\`\`\`

## Backend

- **HTTP Framework**: Chi router
- **Database**: PostgreSQL 17 with pgvector extension
- **ORM/Query**: sqlc (type-safe SQL → Go code generation)
- **WebSocket**: gorilla/websocket for real-time agent status updates
- **Auth**: Google OAuth with JWT tokens

## Frontend

- **Framework**: Next.js 16 (App Router)
- **UI Components**: shadcn/ui (Radix + Tailwind CSS v4)
- **State**: Zustand
- **Styling**: Tailwind CSS v4, OKLCH color system

## Agent Communication

\`\`\`
Server ←→ WebSocket Gateway ←→ Daemon (local machine)
                                   ↓
                              Claude Code / Codex / etc.
\`\`\`

The Daemon is a local process that maintains a persistent WebSocket connection to the server, receives task assignments, and delegates to the underlying AI runtime.`,
    createdBy: "Jiayuan",
    updatedAt: "2026-03-19T14:00:00Z",
    referencedBy: ["MUL-9", "MUL-14"],
  },
  {
    id: "kb_3",
    title: "API Error Handling Convention",
    content: `## Error Response Format

All API errors follow this structure:

\`\`\`json
{
  "error": {
    "code": "ISSUE_NOT_FOUND",
    "message": "Issue with id 'iss_999' not found",
    "details": {}
  }
}
\`\`\`

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| VALIDATION_ERROR | 400 | Request body/params validation failed |
| UNAUTHORIZED | 401 | Missing or invalid auth token |
| FORBIDDEN | 403 | Valid token but insufficient permissions |
| NOT_FOUND | 404 | Resource does not exist |
| CONFLICT | 409 | State conflict (e.g. duplicate) |
| INTERNAL_ERROR | 500 | Unhandled server error |

## Panic Recovery

The server uses a recovery middleware that catches panics, logs the stack trace, and returns a 500 with \`INTERNAL_ERROR\`. Never expose stack traces to clients.`,
    createdBy: "Claude-1",
    updatedAt: "2026-03-20T22:00:00Z",
    referencedBy: ["MUL-6"],
  },
  {
    id: "kb_4",
    title: "Agent Onboarding Guide",
    content: `## How Agents Work in Multica

When an issue is assigned to an agent, the following happens:

1. Server pushes the task to the agent's inbox via WebSocket
2. Daemon receives the task and reads the issue context
3. Agent retrieves relevant Knowledge Base documents
4. Agent executes via the underlying runtime (Claude Code, Codex, etc.)
5. Progress is reported back through WebSocket status updates
6. On completion, agent creates a PR and moves the issue to "In Review"

## Agent Capabilities

- Receive and execute issues
- Create new issues (when blocked or discovering sub-tasks)
- Comment on issues (progress updates, questions)
- Change issue status
- Read Knowledge Base documents
- Create branches, commits, and pull requests

## When Agents Get Blocked

If an agent cannot proceed, it should:
1. Change the issue status to "Blocked"
2. Leave a comment explaining what it needs
3. Create an inbox notification for the assignee with severity "action_required"
4. Wait for human input before continuing`,
    createdBy: "Bohan",
    updatedAt: "2026-03-19T16:00:00Z",
    referencedBy: ["MUL-12", "MUL-15"],
  },
  {
    id: "kb_5",
    title: "Database Schema: Issues",
    content: `## Issues Table

\`\`\`sql
CREATE TABLE issues (
  id            TEXT PRIMARY KEY DEFAULT gen_nanoid(),
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'backlog',
  priority      TEXT NOT NULL DEFAULT 'none',
  assignee_type TEXT,          -- 'member' | 'agent'
  assignee_id   TEXT,
  creator_type  TEXT NOT NULL,
  creator_id    TEXT NOT NULL,
  parent_issue_id TEXT REFERENCES issues(id),
  position      INTEGER NOT NULL DEFAULT 0,
  due_date      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
\`\`\`

## Indexes

\`\`\`sql
CREATE INDEX idx_issues_workspace_status ON issues(workspace_id, status);
CREATE INDEX idx_issues_assignee ON issues(assignee_type, assignee_id);
CREATE INDEX idx_issues_workspace_created ON issues(workspace_id, created_at);
\`\`\`

## Status Values

\`backlog\`, \`todo\`, \`in_progress\`, \`in_review\`, \`done\`, \`blocked\`, \`cancelled\`

## Priority Values

\`urgent\`, \`high\`, \`medium\`, \`low\`, \`none\``,
    createdBy: "Yuzhen",
    updatedAt: "2026-03-18T11:00:00Z",
    referencedBy: ["MUL-9"],
  },
  {
    id: "kb_6",
    title: "PR & Code Review Guidelines",
    content: `## Branch Naming

\`\`\`
feat/short-description
fix/short-description
refactor/short-description
\`\`\`

## Commit Messages

Follow conventional commits:

\`\`\`
feat(scope): add new feature
fix(scope): fix a bug
refactor(scope): code restructure
docs: documentation only
test(scope): add or update tests
chore(scope): maintenance
\`\`\`

## PR Requirements

- Keep PRs small and focused (< 400 lines when possible)
- Include a description of what and why
- All CI checks must pass
- At least one human review required for agent-authored PRs
- Agent PRs are auto-labeled with \`agent-authored\`

## Review Checklist

- [ ] Does the code do what the issue describes?
- [ ] Are there tests for new behavior?
- [ ] No security vulnerabilities introduced
- [ ] No hardcoded secrets or credentials
- [ ] Error handling is appropriate`,
    createdBy: "Bohan",
    updatedAt: "2026-03-17T09:00:00Z",
    referencedBy: ["MUL-3", "MUL-8"],
  },
  {
    id: "kb_7",
    title: "WebSocket Protocol",
    content: `## Connection

\`\`\`
ws://localhost:8080/ws?token=<jwt>
\`\`\`

## Message Format

All messages use JSON:

\`\`\`json
{
  "type": "agent.status_update",
  "payload": { ... },
  "timestamp": "2026-03-20T10:00:00Z"
}
\`\`\`

## Event Types

### Server → Client
- \`agent.status_update\` — Agent status changed (idle/working/blocked/error/offline)
- \`issue.updated\` — Issue fields changed
- \`inbox.new_item\` — New inbox notification
- \`task.progress\` — Agent reports execution progress

### Client → Server
- \`agent.heartbeat\` — Daemon sends periodic heartbeat
- \`task.started\` — Agent began executing a task
- \`task.completed\` — Agent finished a task
- \`task.failed\` — Agent failed a task

## Reconnection

Daemon uses exponential backoff with jitter:
- Initial delay: 1s
- Max delay: 30s
- Jitter: ±25%`,
    createdBy: "Bohan",
    updatedAt: "2026-03-21T04:00:00Z",
    referencedBy: ["MUL-8", "MUL-14"],
  },
];
